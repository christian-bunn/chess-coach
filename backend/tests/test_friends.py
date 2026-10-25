"""Games between two players: the lobby, turns, endings and clocks (with a fake clock)."""

import asyncio

import chess
import pytest

from app.friends import SEEN_SECONDS, FriendGames, GameError


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def games(clock):
    return FriendGames(clock)


def started(games, color="white", time_control="untimed", help="unassisted"):
    game = games.challenge("ann", "Ann", color, time_control, help)
    return games.join("bob", "Bob", game.id)


def play(games, game, *moves):
    for uci in moves:
        white_to_move = len(game.moves) % 2 == 0
        games.move("ann" if white_to_move == (game.white == "ann") else "bob", game.id, uci)


def test_a_challenge_is_listed_for_others_until_someone_joins(games):
    game = games.challenge("ann", "Ann", "black", "10+5", "graded")
    assert games.lobby("bob")["challenges"] == [
        {"id": game.id, "name": "Ann", "color": "black", "time_control": "10+5", "help": "graded"}
    ]
    assert games.lobby("ann") == {"challenges": [], "game": game.id}  # not your own
    games.join("bob", "Bob", game.id)
    assert game.status == "playing" and game.white == "bob" and game.black == "ann"
    assert games.lobby("cat")["challenges"] == []
    assert games.lobby("bob")["game"] == game.id


def test_a_challenge_nobody_follows_drops_out_of_the_lobby(games, clock):
    games.challenge("ann", "Ann", "white", "untimed", "graded")
    clock.now += SEEN_SECONDS + 1
    assert games.lobby("bob")["challenges"] == []


def test_one_challenge_at_a_time(games):
    first = games.challenge("ann", "Ann", "white", "5", "graded")
    second = games.challenge("ann", "Ann", "black", "5", "graded")
    assert [c["id"] for c in games.lobby("bob")["challenges"]] == [second.id]
    with pytest.raises(GameError):
        games.get(first.id)


def test_you_cant_join_your_own_challenge(games):
    game = games.challenge("ann", "Ann", "white", "untimed", "graded")
    with pytest.raises(GameError) as e:
        games.join("ann", "Ann", game.id)
    assert e.value.status == 409


def test_bad_challenges(games):
    for color, tc, help in [("green", "5", "graded"), ("white", "7", "graded"), ("white", "5", "lots")]:
        with pytest.raises(GameError):
            games.challenge("ann", "Ann", color, tc, help)


def test_moves_go_in_turn(games):
    game = started(games)
    with pytest.raises(GameError, match="isn't your move"):
        games.move("bob", game.id, "e7e5")
    games.move("ann", game.id, "e2e4")
    with pytest.raises(GameError, match="isn't legal"):
        games.move("bob", game.id, "e7e4")
    with pytest.raises(GameError, match="not playing"):
        games.move("cat", game.id, "e7e5")
    games.move("bob", game.id, "e7e5")
    assert game.moves == ["e2e4", "e7e5"] and game.sans == ["e4", "e5"]
    assert game.grades == [None, None] and len(game.evals) == 3


def test_checkmate_ends_the_game(games):
    game = started(games)
    play(games, game, "f2f3", "e7e5", "g2g4", "d8h4")
    assert game.status == "over" and game.result == {"reason": "checkmate", "winner": "black"}
    with pytest.raises(GameError, match="over"):
        games.move("ann", game.id, "e2e4")


def test_resigning(games):
    game = started(games)
    games.resign("bob", game.id)
    assert game.result == {"reason": "resigned", "winner": "white"}


def test_a_draw_offer(games):
    game = started(games)
    games.draw("ann", game.id, "offer")
    assert game.draw_offer == "white"
    with pytest.raises(GameError):
        games.draw("ann", game.id, "accept")  # not your own offer
    games.draw("bob", game.id, "decline")
    assert game.draw_offer is None
    games.draw("ann", game.id, "offer")
    games.move("ann", game.id, "e2e4")  # moving withdraws it
    assert game.draw_offer is None
    games.draw("bob", game.id, "offer")
    games.draw("ann", game.id, "accept")
    assert game.result == {"reason": "agreed", "winner": None}


def test_the_clocks(games, clock):
    game = started(games, time_control="3+2")
    clock.now += 5
    games.move("ann", game.id, "e2e4")  # 3:00 - 5s + 2s
    assert game.clock.white == 177_000 and game.clock.running == "black"
    clock.now += 10
    view = games.view(game, "ann")
    assert view["clock"] == {"white": 177_000, "black": 170_000, "increment": 2000, "running": "black"}


def test_running_out_of_time(games, clock):
    game = started(games, time_control="1")
    clock.now += 61
    games.check_time(game)
    assert game.result == {"reason": "timeout", "winner": "black"}
    assert game.clock.white == 0


def test_running_out_of_time_against_a_lone_king_is_a_draw(games, clock):
    game = started(games, time_control="1")
    board = chess.Board("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1")  # White's flag falls, but Black has only the king
    game.board = lambda: board  # type: ignore[method-assign]
    clock.now += 61
    games.check_time(game)
    assert game.result == {"reason": "timeout", "winner": None}


def test_grades_stay_hidden_in_an_unassisted_game_until_it_is_over(games):
    game = started(games, help="unassisted")
    games.move("ann", game.id, "e2e4")
    assert games.view(game, "bob")["grades"] is None and games.view(game, "bob")["evals"] is None
    games.resign("bob", game.id)
    assert games.view(game, "bob")["grades"] == [None]
    graded = started(games, help="graded")
    assert games.view(graded, "ann")["grades"] == []


def test_each_player_sees_their_side(games):
    game = started(games, color="black")
    assert games.view(game, "ann")["you"] == "black" and games.view(game, "bob")["you"] == "white"
    assert games.view(game, "ann")["names"] == {"white": "Bob", "black": "Ann"}


def test_waiting_wakes_up_on_a_move(games):
    game = started(games)

    async def scenario():
        waiter = asyncio.create_task(games.wait(game, game.version))
        await asyncio.sleep(0)
        assert not waiter.done()
        games.move("ann", game.id, "e2e4")
        await asyncio.wait_for(waiter, 1)

    asyncio.run(scenario())
