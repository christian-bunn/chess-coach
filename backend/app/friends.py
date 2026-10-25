"""Games between two players on the same server: challenges in a lobby, and the games themselves.

One player posts a challenge (their colour, a time control, and how much help: "graded" shows both players every
move's grade and the evaluation, "unassisted" shows nothing until the game is over), and another joins it. The
pages follow a game by long-polling it (FriendGames.wait), and the server keeps the clocks. Every move is graded in
the background (main.py), for the game review afterwards. Games live in memory, so restarting the server ends them.
"""

from __future__ import annotations

import asyncio
import random
import secrets
import time
from dataclasses import dataclass, field
from typing import Callable, Literal

import chess

from .grading import Eval, MoveGrade

Color = Literal["white", "black"]

# Minutes each and seconds added per move, by id (the page's clock.ts has the same list).
TIME_CONTROLS = {
    "1": (1, 0), "3": (3, 0), "3+2": (3, 2), "5": (5, 0), "10": (10, 0), "10+5": (10, 5), "15+10": (15, 10),
    "30": (30, 0),
}
UNTIMED = "untimed"
HELP = ("graded", "unassisted")

# A long poll returns after this long even if nothing changed.
POLL_SECONDS = 25.0
# A challenge stays in the lobby while its host's page keeps following it.
SEEN_SECONDS = 40.0
# Challenges nobody is following any more, and finished games, are dropped after this long.
KEEP_SECONDS = 6 * 3600.0

ENDINGS = {
    chess.Termination.CHECKMATE: "checkmate",
    chess.Termination.STALEMATE: "stalemate",
    chess.Termination.INSUFFICIENT_MATERIAL: "insufficient",
    chess.Termination.SEVENTYFIVE_MOVES: "fifty",
    chess.Termination.FIFTY_MOVES: "fifty",
    chess.Termination.FIVEFOLD_REPETITION: "repetition",
    chess.Termination.THREEFOLD_REPETITION: "repetition",
}


class GameError(Exception):
    """A request the game can't take, with the HTTP status to answer it with."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def other(color: Color) -> Color:
    return "black" if color == "white" else "white"


@dataclass
class Clock:
    """Both sides' time left (ms). The running side's started at `since` (seconds, the games' clock)."""

    white: float
    black: float
    increment: float
    running: Color | None = None
    since: float | None = None

    def left(self, side: Color, now: float) -> float:
        used = (now - self.since) * 1000 if self.running == side and self.since is not None else 0
        return max(0.0, getattr(self, side) - used)

    def start(self, side: Color, now: float) -> None:
        self.running, self.since = side, now

    def moved(self, side: Color, now: float) -> None:
        """`side` has moved: charge it the time it took, add the increment, and start the other side's clock."""
        setattr(self, side, self.left(side, now) + self.increment)
        self.start(other(side), now)

    def stop(self, now: float) -> None:
        if self.running:
            setattr(self, self.running, self.left(self.running, now))
        self.running, self.since = None, None


@dataclass
class FriendGame:
    id: str
    host: str  # player id (players.player_id)
    names: dict[str, str]  # player id -> the name they typed
    host_color: str  # "white", "black" or "random"
    time_control: str
    help: str
    created: float
    status: Literal["waiting", "playing", "over"] = "waiting"
    white: str | None = None
    black: str | None = None
    moves: list[str] = field(default_factory=list)  # UCI
    sans: list[str] = field(default_factory=list)
    grades: list[MoveGrade | None] = field(default_factory=list)
    evals: list[Eval | None] = field(default_factory=lambda: [None])  # evals[0]: the starting position
    clock: Clock | None = None
    result: dict | None = None  # {"reason": "checkmate", "resigned", "timeout", ..., "winner": "white"/"black"/None}
    draw_offer: Color | None = None  # who offered one
    ended: float | None = None
    version: int = 0
    seen: dict[str, float] = field(default_factory=dict)  # player id -> when their page last asked
    _changed: asyncio.Event = field(default_factory=asyncio.Event)

    def color_of(self, pid: str) -> Color | None:
        return "white" if pid == self.white else "black" if pid == self.black else None

    def board(self) -> chess.Board:
        board = chess.Board()
        for uci in self.moves:
            board.push_uci(uci)
        return board

    def changed(self) -> None:
        """Wake the pages waiting on this game."""
        self.version += 1
        self._changed.set()
        self._changed = asyncio.Event()

    def end(self, reason: str, winner: Color | None, now: float) -> None:
        self.status, self.result, self.draw_offer, self.ended = "over", {"reason": reason, "winner": winner}, None, now
        if self.clock:
            self.clock.stop(now)


class FriendGames:
    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self.clock = clock
        self._games: dict[str, FriendGame] = {}

    # ------------------------------------------------------------------ the lobby

    def challenge(self, pid: str, name: str, color: str, time_control: str, help: str) -> FriendGame:
        """Post a challenge. A player has one at a time: posting another replaces the one waiting."""
        if color not in ("white", "black", "random"):
            raise GameError(400, f"Unknown colour {color!r}")
        if time_control != UNTIMED and time_control not in TIME_CONTROLS:
            raise GameError(400, f"Unknown time control {time_control!r}")
        if help not in HELP:
            raise GameError(400, f"Unknown help {help!r}")
        if self.current(pid) and self.current(pid).status == "playing":
            raise GameError(409, "Finish your game first")
        for game in list(self._games.values()):
            if game.host == pid and game.status == "waiting":
                del self._games[game.id]
        now = self.clock()
        game = FriendGame(secrets.token_hex(6), pid, {pid: name}, color, time_control, help, created=now)
        game.seen[pid] = now
        self._games[game.id] = game
        return game

    def cancel(self, pid: str, gid: str) -> None:
        game = self.get(gid)
        if game.host != pid or game.status != "waiting":
            raise GameError(409, "That isn't a challenge of yours")
        del self._games[gid]
        game.changed()

    def join(self, pid: str, name: str, gid: str) -> FriendGame:
        """Take up a challenge: the game starts, and White's clock with it."""
        game = self.get(gid)
        if game.status != "waiting":
            raise GameError(409, "Someone has joined that game already")
        if game.host == pid:
            raise GameError(409, "That's your own challenge")
        current = self.current(pid)
        if current and current.status == "playing":
            raise GameError(409, "Finish your game first")
        if current:  # their own waiting challenge goes
            del self._games[current.id]
        host_color = game.host_color if game.host_color != "random" else random.choice(["white", "black"])
        game.white, game.black = (game.host, pid) if host_color == "white" else (pid, game.host)
        game.names[pid] = name
        game.status = "playing"
        now = self.clock()
        game.seen[pid] = now
        if game.time_control != UNTIMED:
            minutes, increment = TIME_CONTROLS[game.time_control]
            game.clock = Clock(minutes * 60_000.0, minutes * 60_000.0, increment * 1000.0)
            game.clock.start("white", now)
        game.changed()
        return game

    def lobby(self, pid: str) -> dict:
        """The challenges others have posted (whose pages are still following them), and this player's game."""
        now = self.clock()
        self._tidy(now)
        challenges = [
            {
                "id": g.id,
                "name": g.names[g.host],
                "color": g.host_color,
                "time_control": g.time_control,
                "help": g.help,
            }
            for g in sorted(self._games.values(), key=lambda g: g.created)
            if g.status == "waiting" and g.host != pid and now - g.seen.get(g.host, 0) < SEEN_SECONDS
        ]
        current = self.current(pid)
        return {"challenges": challenges, "game": current.id if current else None}

    def current(self, pid: str) -> FriendGame | None:
        """The player's game in progress, or their challenge waiting for someone."""
        mine = [g for g in self._games.values() if g.status != "over" and (g.host == pid or g.color_of(pid))]
        return max(mine, key=lambda g: g.created, default=None)

    def _tidy(self, now: float) -> None:
        for game in list(self._games.values()):
            idle = game.status == "waiting" and now - game.seen.get(game.host, 0) > KEEP_SECONDS
            old = game.status == "over" and game.ended is not None and now - game.ended > KEEP_SECONDS
            if idle or old:
                del self._games[game.id]

    # ------------------------------------------------------------------ playing

    def get(self, gid: str) -> FriendGame:
        game = self._games.get(gid)
        if game is None:
            raise GameError(404, "No such game")
        return game

    def _player(self, pid: str, gid: str) -> tuple[FriendGame, Color]:
        game = self.get(gid)
        color = game.color_of(pid)
        if game.status == "waiting" or color is None:
            raise GameError(409, "You're not playing in that game")
        self.check_time(game)
        if game.status != "playing":
            raise GameError(409, "The game is over")
        return game, color

    def move(self, pid: str, gid: str, uci: str) -> tuple[FriendGame, int]:
        """Play a move; returns the game and the move's index (for grading it)."""
        game, color = self._player(pid, gid)
        board = game.board()
        if board.turn != (color == "white"):
            raise GameError(409, "It isn't your move")
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            raise GameError(400, f"Not a move: {uci!r}")
        if move not in board.legal_moves:
            raise GameError(400, f"{uci} isn't legal here")
        now = self.clock()
        game.sans.append(board.san(move))
        board.push(move)
        game.moves.append(uci)
        game.grades.append(None)
        game.evals.append(None)
        game.draw_offer = None
        if game.clock:
            game.clock.moved(color, now)
        outcome = board.outcome(claim_draw=True)
        if outcome:
            winner = None if outcome.winner is None else ("white" if outcome.winner else "black")
            game.end(ENDINGS.get(outcome.termination, "draw"), winner, now)
        game.changed()
        return game, len(game.moves) - 1

    def resign(self, pid: str, gid: str) -> FriendGame:
        game, color = self._player(pid, gid)
        game.end("resigned", other(color), self.clock())
        game.changed()
        return game

    def draw(self, pid: str, gid: str, action: str) -> FriendGame:
        """Offer a draw, or accept or decline the other player's offer. Offering when they've offered accepts it."""
        game, color = self._player(pid, gid)
        theirs = game.draw_offer == other(color)
        if action == "accept" or (action == "offer" and theirs):
            if not theirs:
                raise GameError(409, "There's no draw offer to accept")
            game.end("agreed", None, self.clock())
        elif action == "offer":
            game.draw_offer = color
        elif action == "decline":
            if not theirs:
                raise GameError(409, "There's no draw offer to decline")
            game.draw_offer = None
        else:
            raise GameError(400, f"Unknown draw action {action!r}")
        game.changed()
        return game

    def check_time(self, game: FriendGame) -> None:
        """End the game if the side to move has run out of time: a loss, or a draw if the other side couldn't
        checkmate anyway."""
        clock = game.clock
        if game.status != "playing" or not clock or not clock.running:
            return
        now = self.clock()
        if clock.left(clock.running, now) > 0:
            return
        loser = clock.running
        mate_possible = not game.board().has_insufficient_material(chess.WHITE if loser == "black" else chess.BLACK)
        game.end("timeout", other(loser) if mate_possible else None, now)
        setattr(game.clock, loser, 0.0)
        game.changed()

    # ------------------------------------------------------------------ following a game

    async def wait(self, game: FriendGame, after: int) -> None:
        """Return once the game has changed since `after` (its version), or after POLL_SECONDS. Wakes up when the
        clock of the side to move runs out, too."""
        deadline = self.clock() + POLL_SECONDS
        while game.version <= after:
            self.check_time(game)
            if game.version > after:
                break
            timeout = deadline - self.clock()
            clock = game.clock
            if clock and clock.running and game.status == "playing":
                timeout = min(timeout, clock.left(clock.running, self.clock()) / 1000 + 0.05)
            if timeout <= 0:
                break
            try:
                await asyncio.wait_for(game._changed.wait(), timeout)
            except TimeoutError:
                pass

    def view(self, game: FriendGame, pid: str) -> dict:
        """The game as player `pid` sees it. In an unassisted game, the grades and evaluations stay hidden until
        it's over."""
        now = self.clock()
        game.seen[pid] = now
        show = game.help == "graded" or game.status == "over"
        clock = game.clock
        return {
            "id": game.id,
            "status": game.status,
            "you": game.color_of(pid),
            "host": game.host == pid,
            "names": {
                "white": game.names.get(game.white) if game.white else None,
                "black": game.names.get(game.black) if game.black else None,
            },
            "host_name": game.names[game.host],
            "host_color": game.host_color,
            "time_control": game.time_control,
            "help": game.help,
            "moves": game.moves,
            "sans": game.sans,
            "grades": game.grades if show else None,
            "evals": game.evals if show else None,
            "clock": {
                "white": clock.left("white", now),
                "black": clock.left("black", now),
                "increment": clock.increment,
                "running": clock.running,
            }
            if clock
            else None,
            "result": game.result,
            "draw_offer": game.draw_offer,
            "version": game.version,
        }
