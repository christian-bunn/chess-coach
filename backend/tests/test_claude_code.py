"""Claude Code headless mode, against a fake `claude` program."""

import asyncio
import json
import os
import stat
import sys
from types import SimpleNamespace as NS

import pytest

from app.claude_code import ClaudeCodeExplainer
from app.explain import ExplainError

FAKE_CLAUDE = """\
import json, os, sys

mode = os.environ.get("FAKE_CLAUDE_MODE", "ok")
if sys.argv[1:3] == ["auth", "status"]:
    print(json.dumps({"loggedIn": mode != "logged_out", "authMethod": "api_key" if mode == "api_key" else "claude.ai"}))
    sys.exit(0)

with open(os.environ["FAKE_CLAUDE_LOG"], "w") as log:
    json.dump({"argv": sys.argv[1:], "stdin": sys.stdin.read(), "cwd": os.getcwd(),
               "env": sorted(k for k in os.environ if k.startswith(("ANTHROPIC_", "CLAUDE")))}, log)
if mode == "crash":
    print("something broke", file=sys.stderr)
    sys.exit(2)

def emit(message):
    print(json.dumps(message), flush=True)

emit({"type": "system", "subtype": "init"})
for chunk in ("Nice, ", "that develops."):
    emit({"type": "stream_event", "event": {"type": "content_block_delta", "index": 0,
                                            "delta": {"type": "text_delta", "text": chunk}}})
failed = mode == "error"
emit({"type": "result", "subtype": "success", "is_error": failed, "duration_ms": 900,
      "result": "Not logged in" if failed else "Nice, that develops."})
"""


@pytest.fixture
def make(tmp_path, monkeypatch):
    script = tmp_path / "claude"
    script.write_text(f"#!{sys.executable}\n" + FAKE_CLAUDE)
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    log = tmp_path / "call.json"
    monkeypatch.setenv("FAKE_CLAUDE_LOG", str(log))

    def make_explainer(mode="ok", model=None):
        monkeypatch.setenv("FAKE_CLAUDE_MODE", mode)
        explainer = ClaudeCodeExplainer(NS(coach_model=model, coach_effort="low"), command=str(script))
        asyncio.run(explainer.start())
        return explainer

    make_explainer.call = lambda: json.loads(log.read_text())
    return make_explainer


def collect(explainer, facts="THE FACTS"):
    async def run():
        return [event async for event in explainer.stream(facts)]

    return asyncio.run(run())


@pytest.mark.parametrize(("mode", "available"), [("ok", True), ("logged_out", False), ("api_key", False)])
def test_only_a_subscription_login_turns_it_on(make, mode, available):
    assert make(mode).available is available


def test_not_installed():
    explainer = ClaudeCodeExplainer(NS(coach_model=None, coach_effort="low"), command="no-such-claude-binary")
    asyncio.run(explainer.start())
    assert not explainer.available


def test_streams_the_comment(make):
    events = collect(make())
    assert events == [
        {"type": "text", "text": "Nice, "},
        {"type": "text", "text": "that develops."},
        {"type": "done", "text": "Nice, that develops."},
    ]


def test_command_line_and_input(make):
    explainer = make(model="sonnet")
    collect(explainer, facts="The move: 1.e4")
    call = make.call()
    argv = call["argv"]
    assert argv[0] == "-p"
    assert argv[argv.index("--model") + 1] == "sonnet"
    assert argv[argv.index("--tools") + 1] == ""
    assert argv[argv.index("--effort") + 1] == "low"
    assert "--no-session-persistence" in argv and "--system-prompt" in argv
    assert call["stdin"] == "The move: 1.e4"
    assert os.path.realpath(call["cwd"]) != os.path.realpath(os.getcwd())


def test_an_api_key_never_reaches_claude_code(make, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "token")
    monkeypatch.setenv("CLAUDECODE", "1")
    collect(make())
    env = make.call()["env"]
    assert "ANTHROPIC_API_KEY" not in env and "ANTHROPIC_AUTH_TOKEN" not in env and "CLAUDECODE" not in env


def test_defaults_to_haiku(make):
    collect(make())
    argv = make.call()["argv"]
    assert argv[argv.index("--model") + 1] == "haiku"


def test_error_result_raises(make):
    explainer = make()
    os.environ["FAKE_CLAUDE_MODE"] = "error"
    with pytest.raises(ExplainError, match="Not logged in"):
        collect(explainer)


def test_crash_raises_with_stderr(make):
    explainer = make()
    os.environ["FAKE_CLAUDE_MODE"] = "crash"
    with pytest.raises(ExplainError, match="something broke"):
        collect(explainer)
