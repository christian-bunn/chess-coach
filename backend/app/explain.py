"""Claude writes the coach's comment on each move from the engine's fact sheet."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

import anthropic

from .config import Settings
from .prompts import COMMENT_PROMPT

log = logging.getLogger(__name__)


# Thinking counts towards max_tokens, so leave room beyond the short comment itself.
MAX_TOKENS = 8000
# Models that accept server-side refusal fallbacks in the "default" form.
SERVER_FALLBACK_MODELS = frozenset({"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"})


class ExplainError(Exception):
    """Claude couldn't produce a comment; the caller falls back to the template."""


DEFAULT_MODEL = "claude-opus-5-5"


class Explainer:
    """Comments through the Anthropic API, billed to an API key (separately from any Claude plan)."""

    via = "api"

    def __init__(self, settings: Settings, client: anthropic.AsyncAnthropic | None = None, *, enabled: bool = True):
        self.model = settings.coach_model or DEFAULT_MODEL
        self.effort = settings.coach_effort
        self._client = client
        if self._client is None and enabled:
            self._client = anthropic.AsyncAnthropic(timeout=30.0, max_retries=2)

    @property
    def available(self) -> bool:
        return self._client is not None

    async def stream(self, prompt: str, system: str = COMMENT_PROMPT) -> AsyncIterator[dict]:
        """Stream the comment as events: {"type": "text", "text"}, {"type": "reset"} (discard what
        was streamed so far), then {"type": "done", "text"} with the whole comment.

        Raises ExplainError if Claude can't produce one.
        """
        if self._client is None:
            raise ExplainError("Claude explanations are not configured")
        params: dict = dict(
            model=self.model,
            max_tokens=MAX_TOKENS,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            output_config={"effort": self.effort},
            messages=[{"role": "user", "content": prompt}],
        )
        if self.model in SERVER_FALLBACK_MODELS:
            # If a safety classifier declines (very unlikely for chess), the API retries on a fallback model.
            params.update(betas=["server-side-fallback-2026-07-01"], fallbacks="default")

        parts: list[str] = []
        try:
            async with self._client.beta.messages.stream(**params) as stream:
                async for event in stream:
                    if event.type == "content_block_start" and event.content_block.type == "fallback":
                        # A fallback model takes over; whatever the first model wrote is discarded.
                        parts.clear()
                        yield {"type": "reset"}
                    elif event.type == "content_block_delta" and event.delta.type == "text_delta":
                        parts.append(event.delta.text)
                        yield {"type": "text", "text": event.delta.text}
                final = await stream.get_final_message()
        except anthropic.AuthenticationError as error:
            log.error("Claude rejected the credentials; using template comments from now on: %s", error)
            self._client = None
            raise ExplainError("invalid Anthropic credentials") from error
        except anthropic.RateLimitError as error:
            raise ExplainError("rate limited") from error
        except anthropic.APIStatusError as error:
            log.warning("Claude API error %s: %s", error.status_code, error.message)
            raise ExplainError(f"API error {error.status_code}") from error
        except anthropic.APIConnectionError as error:
            raise ExplainError("couldn't reach the Claude API") from error

        if final.stop_reason == "refusal":
            raise ExplainError("Claude declined to comment")
        text = "".join(parts).strip()
        if final.stop_reason == "max_tokens" or not text:
            raise ExplainError("Claude's comment was cut off")
        log.info(
            "explained move: model=%s in=%s cached=%s out=%s message=%s",
            final.model, final.usage.input_tokens, final.usage.cache_read_input_tokens,
            final.usage.output_tokens, final.id,
        )
        yield {"type": "done", "text": text}
