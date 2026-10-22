"""HTTP API for the chess coach.

The server is stateless: the client sends the full move list (UCI, from the
standard starting position) with every request. Engine results are cached by
position, so re-sending a game costs nothing.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Literal

import chess
import chess.engine
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .coach import describe_opponent_move, describe_user_move, threat_warning
from .advice import HINT_LEVELS, Hypothetical, asks_for_a_move, hint, mentioned_moves, position_facts
from .claude_code import ClaudeCodeExplainer
from .config import Settings, anthropic_credentials_present
from .engine import EngineService
from .explain import ExplainError, Explainer
from .facts import fact_sheet
from .grading import Eval, MoveGrade, grade_move, san_line
from .levels import DEFAULT_LEVEL, LEVELS, LEVELS_BY_ID
from .prompts import CHAT_PROMPT, COMMENT_PROMPT, HINT_PROMPT
from .speech import MAX_TEXT, Speech, voice_label

log = logging.getLogger(__name__)


async def make_explainer(settings: Settings) -> Explainer | ClaudeCodeExplainer:
    """Claude Code on the user's plan first; an API key (billed separately) only if that isn't set up."""
    mode = settings.coach_ai
    if mode in ("auto", "claude-code"):
        claude_code = ClaudeCodeExplainer(settings)
        await claude_code.start()
        if claude_code.available or mode == "claude-code":
            return claude_code
    if mode == "api" or (mode == "auto" and anthropic_credentials_present()):
        return Explainer(settings)
    return Explainer(settings, enabled=False)  # built-in templates only


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s: %(message)s")
    settings = Settings.from_env()
    engines = EngineService(settings)
    await engines.start()
    app.state.engines = engines
    explainer = await make_explainer(settings)
    speech = Speech(settings.voices_dir, settings.voice)
    speech.start()
    app.state.speech = speech
    app.state.explainer = explainer
    log.info(
        "Coach comments: %s",
        f"Claude ({explainer.model}, effort {explainer.effort}) via {explainer.via}" if explainer.available
        else "built-in templates",
    )
    try:
        yield
    finally:
        await engines.stop()


app = FastAPI(title="Chess Coach", lifespan=lifespan)


class MovesIn(BaseModel):
    moves: list[str] = Field(default_factory=list, max_length=2000)


class BotMoveIn(MovesIn):
    level: str = DEFAULT_LEVEL


class ExplainIn(MovesIn):
    student_color: Literal["white", "black"]
    # False while the student is being offered a retry, so the comment can't give the answer away.
    reveal_best: bool = True


class HintIn(MovesIn):
    student_color: Literal["white", "black"]
    level: int = Field(1, ge=1, le=HINT_LEVELS)


class SpeechIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    voice: str | None = None  # one of /api/voices; default: the server's default voice


class Exchange(BaseModel):
    question: str = Field(max_length=1000)
    answer: str = Field(max_length=2000)


class AskIn(MovesIn):
    student_color: Literal["white", "black"]
    question: str = Field(min_length=1, max_length=500)
    history: list[Exchange] = Field(default_factory=list, max_length=6)
    # False while the student is being offered a retry of their last move.
    reveal_best: bool = True


@dataclass
class LevelOut:
    id: str
    name: str
    elo: int
    description: str


@dataclass
class LineOut:
    uci: str
    san: str
    eval: Eval
    pv: list[str]


@dataclass
class AnalysisOut:
    eval: Eval
    lines: list[LineOut]


def _engines(request: Request) -> EngineService:
    return request.app.state.engines


def _replay(moves: list[str]) -> chess.Board:
    board = chess.Board()
    for ply, uci in enumerate(moves, start=1):
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            raise HTTPException(400, f"Move {ply} is not valid UCI notation: {uci!r}")
        if move not in board.legal_moves:
            raise HTTPException(400, f"Move {ply} ({uci}) is illegal in this position")
        board.push(move)
    return board


async def _grade(engines: EngineService, board: chess.Board, move: chess.Move) -> MoveGrade:
    after_board = board.copy()
    after_board.push(move)
    before = await engines.analyse(board)
    after = await engines.analyse(after_board)
    return grade_move(board, move, before, after)


@app.get("/api/health")
async def health(request: Request) -> dict[str, str]:
    return {"status": "ok", "engine": _engines(request).name}


@app.get("/api/config")
async def config(request: Request) -> dict[str, str | bool | None]:
    explainer: Explainer | ClaudeCodeExplainer = request.app.state.explainer
    on = explainer.available
    return {
        "coach_ai": on,
        "model": explainer.model if on else None,
        "via": explainer.via if on else None,
        "voice": request.app.state.speech.available,
    }


@app.post("/api/speech")
async def speech(body: SpeechIn, request: Request) -> Response:
    """`text` read aloud by the coach's voice, as a WAV file."""
    voice: Speech = request.app.state.speech
    if not voice.available:
        raise HTTPException(503, "The coach's voice isn't set up (see README: Speak)")
    try:
        audio = await voice.wav(body.text, body.voice)
    except ValueError as error:
        raise HTTPException(400, str(error))
    return Response(audio, media_type="audio/wav")


@app.get("/api/voices")
async def voices(request: Request) -> dict:
    """The installed voices the student can choose from, and the default one."""
    voice: Speech = request.app.state.speech
    if not voice.available:
        return {"voices": [], "default": None}
    return {"voices": [{"name": n, "label": voice_label(n)} for n in voice.voices()], "default": voice.default}


@app.get("/api/levels")
async def levels() -> list[LevelOut]:
    return [LevelOut(l.id, l.name, l.elo, l.description) for l in LEVELS]


@app.post("/api/analyze")
async def analyze(body: MovesIn, request: Request) -> AnalysisOut:
    """Evaluate the current position (for the eval bar and, later, hints)."""
    board = _replay(body.moves)
    analysis = await _engines(request).analyse(board)
    lines = [
        LineOut(
            uci=line.move.uci(),
            san=board.san(line.move),
            eval=Eval.from_white_score(chess.engine.PovScore(line.score, board.turn).white()),
            pv=san_line(board, line.pv),
        )
        for line in analysis.lines
    ]
    return AnalysisOut(eval=Eval.from_white_score(analysis.white_score()), lines=lines)


@app.post("/api/grade")
async def grade(body: MovesIn, request: Request) -> MoveGrade:
    """Grade the last move in `moves` (the user's move) and add a coach comment."""
    if not body.moves:
        raise HTTPException(400, "No move to grade")
    before = _replay(body.moves[:-1])
    move = _replay(body.moves).peek()
    result = await _grade(_engines(request), before, move)
    result.message = describe_user_move(result, before)
    return result


@app.post("/api/bot-move")
async def bot_move(body: BotMoveIn, request: Request) -> MoveGrade:
    """Let the opponent pick a move at the chosen strength, and grade it."""
    level = LEVELS_BY_ID.get(body.level)
    if level is None:
        raise HTTPException(400, f"Unknown level {body.level!r}")
    board = _replay(body.moves)
    if board.is_game_over(claim_draw=True):
        raise HTTPException(409, "The game is over")
    engines = _engines(request)
    # The analysis of the current position is usually cached already; if not, run it alongside.
    move, _ = await asyncio.gather(engines.play(board, level), engines.analyse(board))
    result = await _grade(engines, board, move)
    after_board = board.copy()
    after_board.push(move)
    result.message = describe_opponent_move(result, threat_warning(after_board, await engines.threat(after_board)))
    return result


@app.post("/api/explain")
async def explain(body: ExplainIn, request: Request) -> StreamingResponse:
    """Stream a coach comment on the last move in `moves`, as newline-delimited JSON events:
    {"type": "text", "text"} chunks, {"type": "reset"} to discard what came so far, and a final
    {"type": "done", "text", "source": "claude" | "template"}. The template is the fallback
    whenever Claude isn't configured or fails.
    """
    if not body.moves:
        raise HTTPException(400, "No move to explain")
    board = _replay(body.moves[:-1])
    move = _replay(body.moves).peek()
    engines = _engines(request)
    after_board = board.copy()
    after_board.push(move)
    before = await engines.analyse(board)
    after = await engines.analyse(after_board)
    grade = grade_move(board, move, before, after)

    student_color = chess.WHITE if body.student_color == "white" else chess.BLACK
    by_student = board.turn == student_color
    template = describe_user_move(grade, board) if by_student else describe_opponent_move(grade)
    explainer: Explainer | ClaudeCodeExplainer = request.app.state.explainer

    async def facts() -> str:
        threat = await engines.threat(after_board)
        return fact_sheet(
            board, move, grade, before, after, threat,
            student_color=student_color, reveal_best=body.reveal_best,
        )

    return _stream(explainer, facts, COMMENT_PROMPT, template or "")


def _event(event: dict) -> str:
    return json.dumps(event) + "\n"


def _stream(
    explainer: Explainer | ClaudeCodeExplainer,
    prompt: Callable[[], Awaitable[str]],
    system: str,
    fallback: str,
    first: dict | None = None,
) -> StreamingResponse:
    """Stream Claude's text as newline-delimited JSON events: optionally `first`, then {"type": "text"}
    chunks, {"type": "reset"} to discard what came so far, and a final {"type": "done", "text",
    "source": "claude" | "template"}. `fallback` is used whenever Claude isn't available or fails.
    `prompt` is only built when Claude will actually be asked.
    """

    async def events() -> AsyncIterator[str]:
        if first is not None:
            yield _event(first)
        if explainer.available:
            try:
                async for event in explainer.stream(await prompt(), system):
                    yield _event({**event, "source": "claude"} if event["type"] == "done" else event)
                return
            except ExplainError as error:
                log.warning("Falling back to the built-in text: %s", error)
                yield _event({"type": "reset"})
            except Exception:
                # A bug here shouldn't leave the student without an answer.
                log.exception("Asking Claude failed; falling back to the built-in text")
                yield _event({"type": "reset"})
        yield _event({"type": "done", "text": fallback, "source": "template"})

    return StreamingResponse(events(), media_type="application/x-ndjson")


@app.post("/api/hint")
async def hint_endpoint(body: HintIn, request: Request) -> StreamingResponse:
    """A hint for the student's move. Level 1 names the idea, 2 the piece, 3 the move; the last
    level's stream starts with {"type": "move", "uci"} so the board can show an arrow."""
    board = _replay(body.moves)
    student_color = chess.WHITE if body.student_color == "white" else chess.BLACK
    if board.turn != student_color or board.is_game_over(claim_draw=True):
        raise HTTPException(409, "It isn't your move")
    engines = _engines(request)
    analysis = await engines.analyse(board)
    threat = await engines.threat(board)
    result = hint(board, analysis, threat, body.level, student_color)

    async def facts() -> str:
        return result.facts

    first = {"type": "move", "uci": result.move} if result.move else None
    return _stream(request.app.state.explainer, facts, HINT_PROMPT, result.template, first)


@app.post("/api/ask")
async def ask(body: AskIn, request: Request) -> StreamingResponse:
    """Answer the student's question about the current position. Moves it mentions are checked by
    the engine first, so the answer can rely on them."""
    board = _replay(body.moves)
    explainer: Explainer | ClaudeCodeExplainer = request.app.state.explainer
    fallback = (
        "I can only answer questions when Claude is set up. Log in to Claude Code "
        "(see the README), then ask me again."
    )

    async def prompt() -> str:
        engines = _engines(request)
        student_color = chess.WHITE if body.student_color == "white" else chess.BLACK
        analysis = await engines.analyse(board)
        threat = await engines.threat(board) if board.turn == student_color else None
        last = None
        if board.move_stack:
            before = board.copy()
            before.pop()
            last = await _grade(engines, before, board.peek())
        legal, not_legal = mentioned_moves(board, body.question)
        hypotheticals = []
        for move in legal:
            after_board = board.copy()
            after_board.push(move)
            after = await engines.analyse(after_board)
            hypotheticals.append(Hypothetical(move, grade_move(board, move, analysis, after), after))
        facts = position_facts(
            board, analysis, threat, student_color=student_color, last=last,
            reveal_last_best=body.reveal_best, hypotheticals=hypotheticals, not_legal=not_legal,
            show_best_moves=asks_for_a_move(body.question),
        )
        earlier = "".join(f"Student: {x.question}\nCoach: {x.answer}\n\n" for x in body.history)
        return (
            (f"Earlier in this conversation:\n{earlier}" if earlier else "")
            + f"Facts about the current position:\n{facts}\n\nThe student's question: {body.question}"
        )

    return _stream(explainer, prompt, CHAT_PROMPT, fallback)
