"""HTTP API for the chess coach.

The server is stateless: the client sends the full move list (UCI, from the
standard starting position) with every request. Engine results are cached by
position, so re-sending a game costs nothing.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Literal

import chess
import chess.engine
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .coach import describe_opponent_move, describe_user_move
from .claude_code import ClaudeCodeExplainer
from .config import Settings, anthropic_credentials_present
from .engine import EngineService
from .explain import ExplainError, Explainer
from .facts import fact_sheet
from .grading import Eval, MoveGrade, grade_move, san_line
from .levels import DEFAULT_LEVEL, LEVELS, LEVELS_BY_ID

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
    return {"coach_ai": on, "model": explainer.model if on else None, "via": explainer.via if on else None}


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
    result.message = describe_opponent_move(result)
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

    async def events() -> AsyncIterator[str]:
        if explainer.available:
            threat = await engines.threat(after_board)
            facts = fact_sheet(
                board, move, grade, before, after, threat,
                student_color=student_color, reveal_best=body.reveal_best,
            )
            try:
                async for event in explainer.stream(facts):
                    yield json.dumps({**event, "source": "claude"} if event["type"] == "done" else event) + "\n"
                return
            except ExplainError as error:
                log.warning("Falling back to the template comment: %s", error)
                yield json.dumps({"type": "reset"}) + "\n"
            except Exception:
                # A bug here shouldn't leave the student without a comment.
                log.exception("Explaining the move failed; falling back to the template comment")
                yield json.dumps({"type": "reset"}) + "\n"
        yield json.dumps({"type": "done", "text": template or "", "source": "template"}) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")
