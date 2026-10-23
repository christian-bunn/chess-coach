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
from .guide import plan
from .grading import RETRY_CLASSIFICATIONS, Eval, MoveGrade, grade_move, san_line
from .levels import DEFAULT_LEVEL, LEVELS, LEVELS_BY_ID
from .openings import load as load_openings, mark_book
from .puzzles import Puzzle, PuzzleStore
from .speech import MAX_TEXT, Speech, voice_label

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s: %(message)s")
    settings = Settings.from_env()
    engines = EngineService(settings)
    await engines.start()
    app.state.engines = engines
    await asyncio.to_thread(load_openings)
    app.state.puzzles = PuzzleStore(settings.progress_dir / "puzzles.json")
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


class HintIn(MovesIn):
    student_color: Literal["white", "black"]
    level: int = Field(1, ge=1, le=HINT_LEVELS)


class AttemptIn(BaseModel):
    uci: str = Field(min_length=4, max_length=5)


class ResultIn(BaseModel):
    solved: bool  # found at the first try, without asking for the solution


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
class AttemptOut:
    grade: MoveGrade
    correct: bool


# A puzzle counts as solved by a move as good as the engine's, or nearly.
SOLVED_GRADES = frozenset({"best", "great", "excellent", "book"})


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


def _students_move(body: HintIn) -> chess.Board:
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
    return mark_book(grade_move(board, move, before, after), board, move)


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
    return await _grade(engines, board, move)


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


# ------------------------------------------------------------------------------------- puzzles


def _puzzles(request: Request) -> PuzzleStore:
    return request.app.state.puzzles


def _puzzle(request: Request, pid: str) -> Puzzle:
    puzzle = _puzzles(request).get(pid)
    if puzzle is None:
        raise HTTPException(404, "No such puzzle")
    return puzzle


@app.get("/api/puzzles")
async def puzzles_summary(request: Request) -> dict:
    """How many puzzles are saved, due now and mastered, and when the next one is due."""
    return _puzzles(request).summary()


@app.get("/api/puzzles/next")
async def next_puzzle(request: Request, early: bool = False) -> Puzzle | None:
    """The puzzle to do now: the one due longest ago. With `early`, the one due soonest if none is due."""
    return _puzzles(request).next(early)


@app.post("/api/puzzles")
async def save_puzzle(body: MovesIn, request: Request) -> dict:
    """Save the last move in `moves` (the student's) as a puzzle if it was a mistake, a missed win or a blunder,
    or missed a mate. The puzzle is the position before it."""
    if not body.moves:
        raise HTTPException(400, "No move to save")
    board = _replay(body.moves[:-1])
    move = _replay(body.moves).peek()
    grade = await _grade(_engines(request), board, move)
    if not (grade.classification in RETRY_CLASSIFICATIONS or grade.missed_mate_in) or not grade.best_move:
        return {"saved": False, "id": None}
    puzzle = _puzzles(request).add(
        board.epd(),
        moves=body.moves[:-1],
        color="white" if board.turn == chess.WHITE else "black",
        played=move.uci(),
        played_san=board.san(move),
        best=grade.best_move,
        best_san=grade.best_san,
        grade=grade.classification,
        comment=describe_user_move(grade, board),
        opening=grade.opening,
    )
    return {"saved": True, "id": puzzle.id}


@app.post("/api/puzzles/{pid}/attempt")
async def attempt_puzzle(pid: str, body: AttemptIn, request: Request) -> AttemptOut:
    """Grade a move tried on a puzzle, with the coach's comment, and whether it solves it."""
    board = _replay(_puzzle(request, pid).moves)
    try:
        move = chess.Move.from_uci(body.uci)
    except ValueError:
        raise HTTPException(400, f"Not a move: {body.uci!r}")
    if move not in board.legal_moves:
        raise HTTPException(400, f"{body.uci} isn't legal here")
    grade = await _grade(_engines(request), board, move)
    grade.message = describe_user_move(grade, board)
    return AttemptOut(grade, grade.classification in SOLVED_GRADES or grade.delivers_mate)


@app.post("/api/puzzles/{pid}/result")
async def puzzle_result(pid: str, body: ResultIn, request: Request) -> Puzzle:
    """Record a review (once per puzzle shown), which sets when the puzzle comes back."""
    _puzzle(request, pid)
    return _puzzles(request).record(pid, body.solved)


@app.delete("/api/puzzles/{pid}")
async def remove_puzzle(pid: str, request: Request) -> dict:
    _puzzle(request, pid)
    _puzzles(request).remove(pid)
    return {"removed": True}
