"""HTTP API for the chess coach.

The server is stateless: the client sends the full move list (UCI, from the
standard starting position) with every request. Engine results are cached by
position, so re-sending a game costs nothing.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Literal

import chess
import chess.engine
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .advice import HINT_LEVELS, hint
from .coach import describe_user_move
from .config import Settings
from .engine import EngineService
from .guide import guidance, plan
from .grading import Eval, MoveGrade, grade_move, san_line
from .levels import DEFAULT_LEVEL, LEVELS, LEVELS_BY_ID
from .speech import MAX_TEXT, Speech, voice_label

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s: %(message)s")
    settings = Settings.from_env()
    engines = EngineService(settings)
    await engines.start()
    app.state.engines = engines
    speech = Speech(settings.voices_dir, settings.voice)
    speech.start()
    app.state.speech = speech
    try:
        yield
    finally:
        await engines.stop()


app = FastAPI(title="Chess Coach", lifespan=lifespan)


class MovesIn(BaseModel):
    moves: list[str] = Field(default_factory=list, max_length=2000)


class BotMoveIn(MovesIn):
    level: str = DEFAULT_LEVEL


class GuideIn(MovesIn):
    student_color: Literal["white", "black"]


class HintIn(MovesIn):
    student_color: Literal["white", "black"]
    level: int = Field(1, ge=1, le=HINT_LEVELS)


class SpeechIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    voice: str | None = None  # one of /api/voices; default: the server's default voice


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


@dataclass
class HintOut:
    text: str
    square: str | None  # the piece to move (level 2 on), highlighted on the board
    move: str | None  # UCI of the move (level 3), shown as an arrow


@dataclass
class GuideOut:
    text: str
    topic: str
    urgent: bool


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


def _students_move(body: GuideIn | HintIn) -> chess.Board:
    """The position in `body`, which must be the student's move in a game that's still going."""
    board = _replay(body.moves)
    student_color = chess.WHITE if body.student_color == "white" else chess.BLACK
    if board.turn != student_color or board.is_game_over(claim_draw=True):
        raise HTTPException(409, "It isn't your move")
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
async def config(request: Request) -> dict[str, bool]:
    return {"voice": request.app.state.speech.available}


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
    """Evaluate the current position (for the eval bar)."""
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
    threat = await engines.threat(after_board)
    if (next_plan := plan(after_board, await engines.analyse(after_board), threat)) is not None:
        result.guide_topic, result.guide_urgent = next_plan.topic, next_plan.urgent
    return result


@app.post("/api/hint")
async def hint_endpoint(body: HintIn, request: Request) -> HintOut:
    """A hint for the student's move. Level 1 names the idea, level 2 shows the piece to move, and
    level 3 shows the move itself."""
    board = _students_move(body)
    engines = _engines(request)
    analysis = await engines.analyse(board)
    threat = await engines.threat(board)
    result = hint(board, analysis, threat, body.level, plan(board, analysis, threat))
    return HintOut(result.text, result.square, result.move)


@app.post("/api/guide")
async def guide(body: GuideIn, request: Request) -> GuideOut:
    """The coach's guidance before the student's move: what matters and what to aim for, without the
    move itself."""
    board = _students_move(body)
    engines = _engines(request)
    analysis = await engines.analyse(board)
    threat = await engines.threat(board)
    the_plan = plan(board, analysis, threat)
    last = None
    if board.move_stack:
        before = board.copy()
        before.pop()
        last = await _grade(engines, before, board.peek())
    return GuideOut(guidance(the_plan, last), the_plan.topic, the_plan.urgent)
