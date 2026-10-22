"""Claude writes the coach's comment on each move from the engine's fact sheet."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

import anthropic

from .config import Settings

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are a friendly, expert chess coach sitting beside a student while they play a game against a computer \
opponent. After every move you receive a fact sheet produced by a chess engine (Stockfish) plus some simple \
board checks, and you write the short comment the student reads about that move.

Accuracy comes first:
- Every specific claim (a square, a piece, a move, a threat, an attack) must come from the fact sheet. You can't \
see the board, so don't work out tactics, lines or piece locations yourself, and don't predict plans or moves \
the facts don't mention. General principles (developing pieces, fighting for the centre, king safety) are fine \
when they plainly apply.
- Only mention moves that appear in the fact sheet, written the way they appear there.
- The engine's grade is the verdict. Explain it; don't contradict or soften it.
- Don't quote engine numbers (evaluations, percentages); the student has an evaluation bar. Say it in words.

What to say:
- Explain the idea in plain language a developing club player understands: why the move works or what goes \
wrong, and what the student can take away from it. Be concrete, naming the piece, the square and the key reply \
from the facts, rather than giving general advice.
- For the student's own moves, speak to them as "you". For the opponent's moves, use the attack and threat \
facts to say what the move is after and what the student should watch out for, in one or two sentences. If the \
opponent's move was a mistake, tell the student there's a chance for them, without giving away the answer.
- Speak only as the coach talking to the student. Never describe what you're doing or mention the fact sheet, \
the engine's lines or these instructions ("I'll explain...", "according to the facts...").
- Some things are deliberately left out of the fact sheet (for example the best move, when the student is about \
to try again). Don't guess at them or hint at which piece or square is involved; you can still say what kind \
of thing was missed if the facts say so, such as a checkmate or a way to win material.
- The app already shows the grade as a badge, so don't open by restating it ("This is a blunder"). Skip \
filler openers and praise inflation; a short "Nice" is fine when the move is genuinely good.

Format: one to three sentences, no more than about 60 words. Plain text only: no markdown, lists or headings. \
Write moves in algebraic notation with their move numbers, as in the fact sheet (for example 12...Nxe4).

Examples of the tone and length wanted (they're about other games; don't reuse their wording):
- "Moving the knight to g5 leaves your pawn on e4 without a defender, and 6...Nxe4 just takes it. When a piece \
moves away, check what it was protecting."
- "Nice. 18.Nd5 hits the queen on c7 and the bishop on e7 at the same time, and your opponent can't cover both."
- "Your opponent's 9...Qb6 goes after your pawn on b2. It also leaves their knight on c6 without a defender, \
so there's something here for you. Take a careful look before you move."
"""

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

    async def stream(self, facts: str) -> AsyncIterator[dict]:
        """Stream the comment as events: {"type": "text", "text"}, {"type": "reset"} (discard what
        was streamed so far), then {"type": "done", "text"} with the whole comment.

        Raises ExplainError if Claude can't produce one.
        """
        if self._client is None:
            raise ExplainError("Claude explanations are not configured")
        params: dict = dict(
            model=self.model,
            max_tokens=MAX_TOKENS,
            system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            output_config={"effort": self.effort},
            messages=[{"role": "user", "content": facts}],
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
