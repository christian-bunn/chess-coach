"""The Claude explainer, against a fake client that replays canned stream events."""

import asyncio
import json
from types import SimpleNamespace as NS

import anthropic
import httpx2
import pytest

from app.explain import ExplainError, Explainer

SETTINGS = NS(coach_model="claude-opus-5-5", coach_effort="low", coach_ai=False)


def text(chunk):
    return NS(type="content_block_delta", delta=NS(type="text_delta", text=chunk))


def block_start(block_type):
    return NS(type="content_block_start", content_block=NS(type=block_type))


def final(stop_reason="end_turn"):
    usage = NS(input_tokens=900, cache_read_input_tokens=0, output_tokens=40)
    return NS(stop_reason=stop_reason, model="claude-opus-5-5", usage=usage, id="msg_test")


class FakeStream:
    def __init__(self, events, final_message):
        self.events, self.final_message = events, final_message

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for event in self.events:
            if isinstance(event, Exception):
                raise event
            yield event

    async def get_final_message(self):
        return self.final_message


class FakeClient:
    def __init__(self, events, final_message=None):
        self.calls = []
        self.events, self.final_message = events, final_message or final()
        self.beta = NS(messages=NS(stream=self._stream))

    def _stream(self, **params):
        self.calls.append(params)
        return FakeStream(self.events, self.final_message)


def collect(explainer, facts="facts"):
    async def run():
        return [event async for event in explainer.stream(facts)]

    return asyncio.run(run())


def test_streams_text_then_done():
    client = FakeClient([block_start("text"), text("Nice. "), text("That develops a piece.")])
    events = collect(Explainer(SETTINGS, client=client))
    assert [e["type"] for e in events] == ["text", "text", "done"]
    assert events[-1]["text"] == "Nice. That develops a piece."


def test_request_shape():
    client = FakeClient([text("Fine.")])
    collect(Explainer(SETTINGS, client=client), facts="THE FACTS")
    params = client.calls[0]
    assert params["model"] == "claude-opus-5-5"
    assert params["output_config"] == {"effort": "low"}
    assert params["messages"] == [{"role": "user", "content": "THE FACTS"}]
    assert params["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert params["fallbacks"] == "default"
    assert params["betas"] == ["server-side-fallback-2026-07-01"]
    assert "thinking" not in params  # adaptive by default; Opus 5.5 rejects disabling it


def test_no_fallbacks_for_models_without_server_side_support():
    client = FakeClient([text("Fine.")])
    collect(Explainer(NS(coach_model="claude-haiku-5-5", coach_effort="low", coach_ai=False), client=client))
    assert "fallbacks" not in client.calls[0] and "betas" not in client.calls[0]


def test_fallback_model_takeover_resets_the_text():
    client = FakeClient([text("Partial from the first model"), block_start("fallback"), text("Clean answer.")])
    events = collect(Explainer(SETTINGS, client=client))
    assert [e["type"] for e in events] == ["text", "reset", "text", "done"]
    assert events[-1]["text"] == "Clean answer."


def test_refusal_raises():
    client = FakeClient([], final("refusal"))
    with pytest.raises(ExplainError):
        collect(Explainer(SETTINGS, client=client))


def test_truncated_comment_raises():
    client = FakeClient([text("This was cut")], final("max_tokens"))
    with pytest.raises(ExplainError):
        collect(Explainer(SETTINGS, client=client))


def test_bad_credentials_switch_the_explainer_off():
    response = httpx2.Response(401, request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages"))
    error = anthropic.AuthenticationError("invalid x-api-key", response=response, body=None)
    explainer = Explainer(SETTINGS, client=FakeClient([error]))
    with pytest.raises(ExplainError):
        collect(explainer)
    assert not explainer.available


def test_disabled_explainer_is_unavailable():
    explainer = Explainer(SETTINGS, enabled=False)
    assert not explainer.available
    with pytest.raises(ExplainError):
        collect(explainer)


def sse(*events):
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()


def test_real_sdk_parses_the_stream():
    """Run the actual SDK over a mock transport, so the fakes above can't drift from the real types."""
    body = sse(
        {"type": "message_start", "message": {
            "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [],
            "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 900, "output_tokens": 1}}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Nice, "}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "that develops."}},
        {"type": "content_block_stop", "index": 0},
        {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
         "usage": {"output_tokens": 12}},
        {"type": "message_stop"},
    )
    requests = []

    def handler(request):
        requests.append(request)
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    client = anthropic.AsyncAnthropic(
        api_key="test", http_client=anthropic.DefaultAsyncHttpxClient(transport=httpx2.MockTransport(handler))
    )
    events = collect(Explainer(SETTINGS, client=client))
    assert events[-1] == {"type": "done", "text": "Nice, that develops."}
    assert requests[0].headers["anthropic-beta"] == "server-side-fallback-2026-07-01"
    assert json.loads(requests[0].content)["fallbacks"] == "default"
