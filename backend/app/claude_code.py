"""Coach comments written through Claude Code's headless mode (`claude -p`), on the user's Claude plan.

This runs the unmodified `claude` program under the user's own login, for their own use on their own
machine. It never touches Claude Code's credentials itself. Don't host or share the app in this mode:
anyone else using it would be using this user's subscription. Use an API key (explain.Explainer) for that.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import tempfile
from collections.abc import AsyncIterator

from .config import Settings
from .explain import ExplainError
from .prompts import COMMENT_PROMPT

log = logging.getLogger(__name__)

# Removed from the child's environment. An API key would make `claude -p` bill the API instead of the
# plan; the CLAUDE_CODE markers would make it think it's nested inside another Claude Code session.
STRIPPED_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")
# `claude auth status` reports this for a Claude subscription login (as opposed to e.g. "api_key").
SUBSCRIPTION_AUTH = "claude.ai"
DEFAULT_MODEL = "haiku"
TIMEOUT_SECONDS = 60
# The user's move and the opponent's reply are explained at the same time; more would just queue.
MAX_CONCURRENT = 2


class ClaudeCodeExplainer:
    via = "claude-code"

    def __init__(self, settings: Settings, command: str = "claude"):
        self.model = settings.coach_model or DEFAULT_MODEL
        self.effort = settings.coach_effort
        self.command = shutil.which(command)
        self._available = False
        self._slots = asyncio.Semaphore(MAX_CONCURRENT)
        # An empty working directory, so the project's CLAUDE.md and memory aren't loaded into every call.
        self._workdir = tempfile.mkdtemp(prefix="chess-coach-")

    @property
    def available(self) -> bool:
        return self._available

    @staticmethod
    def _env() -> dict[str, str]:
        return {k: v for k, v in os.environ.items() if k not in STRIPPED_ENV}

    async def start(self) -> None:
        """Turn on only if Claude Code is installed and logged in with a Claude subscription."""
        if self.command is None:
            log.info("Claude Code isn't installed (no `claude` on PATH)")
            return
        try:
            proc = await asyncio.create_subprocess_exec(
                self.command, "auth", "status", "--json",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                env=self._env(), cwd=self._workdir,
            )
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=20)
            status = json.loads(out)
        except (OSError, TimeoutError, ValueError) as error:
            log.warning("Couldn't check Claude Code's login: %s", error)
            return
        method = status.get("authMethod")
        if status.get("loggedIn") and method == SUBSCRIPTION_AUTH:
            self._available = True
        elif status.get("loggedIn"):
            log.warning(
                "Claude Code is logged in with %r, not a Claude subscription, so it won't be used "
                "(it would bill the API). Run `claude` and /login with your Claude account.", method,
            )
        else:
            log.info("Claude Code isn't logged in. Run `claude` once and log in with your Claude account.")

    def _args(self, system: str) -> list[str]:
        return [
            self.command, "-p",
            "--model", self.model,
            "--effort", self.effort,
            "--system-prompt", system,
            "--tools", "",
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--no-session-persistence",
            "--output-format", "stream-json", "--verbose", "--include-partial-messages",
        ]

    async def stream(self, prompt: str, system: str = COMMENT_PROMPT) -> AsyncIterator[dict]:
        """Same events as explain.Explainer.stream: text chunks, then {"type": "done", "text"}."""
        if not self._available:
            raise ExplainError("Claude Code isn't available")
        async with self._slots:
            proc = await asyncio.create_subprocess_exec(
                *self._args(system),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                env=self._env(), cwd=self._workdir, limit=1 << 20,
            )
            # Read stderr alongside stdout so a chatty process can't fill the pipe and stall.
            stderr = asyncio.create_task(proc.stderr.read())
            try:
                async with asyncio.timeout(TIMEOUT_SECONDS):
                    proc.stdin.write(prompt.encode())
                    await proc.stdin.drain()
                    proc.stdin.close()
                    result = None
                    async for raw in proc.stdout:
                        try:
                            message = json.loads(raw)
                        except ValueError:
                            continue
                        if message.get("type") == "stream_event":
                            event = message.get("event") or {}
                            delta = event.get("delta") or {}
                            if event.get("type") == "content_block_delta" and delta.get("type") == "text_delta":
                                yield {"type": "text", "text": delta.get("text", "")}
                        elif message.get("type") == "result":
                            result = message
                    await proc.wait()
            except TimeoutError as error:
                raise ExplainError("Claude Code took too long") from error
            finally:
                if proc.returncode is None:
                    proc.kill()
                    await proc.wait()
                errors = (await stderr).decode(errors="replace").strip()

        if result is None:
            raise ExplainError(f"Claude Code exited with {proc.returncode}: {errors[:300]}")
        text = (result.get("result") or "").strip()
        if result.get("is_error") or result.get("subtype") != "success" or not text:
            raise ExplainError(f"Claude Code failed: {text[:300] or result.get('subtype')}")
        log.info("explained move via Claude Code: model=%s duration=%sms", self.model, result.get("duration_ms"))
        yield {"type": "done", "text": text}
