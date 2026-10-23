"""The puzzle store: saving mistakes, and spaced repetition."""

from datetime import UTC, datetime, timedelta

from app.puzzles import MASTERED_STREAK, PuzzleStore


class Clock:
    def __init__(self):
        self.now = datetime(2026, 10, 23, 12, 0, tzinfo=UTC)

    def __call__(self):
        return self.now

    def days(self, n):
        self.now += timedelta(days=n)


def fields(**extra):
    return {
        "moves": ["e2e4", "d7d5"], "color": "white", "played": "d1g4", "played_san": "Qg4", "best": "e4d5",
        "best_san": "exd5", "grade": "blunder", "comment": "Blunder!", "opening": "Scandinavian Defense", **extra,
    }


def store(tmp_path, clock):
    return PuzzleStore(tmp_path / "puzzles.json", clock)


def test_a_new_puzzle_comes_back_the_next_day(tmp_path):
    clock = Clock()
    s = store(tmp_path, clock)
    p = s.add("position-a", **fields())
    assert s.summary() == {"total": 1, "due": 0, "mastered": 0, "next_due": p.due}
    assert s.next() is None and s.next(early=True).id == p.id  # early: the soonest one anyway
    clock.days(1)
    assert s.next().id == p.id and s.summary()["due"] == 1


def test_solving_spreads_reviews_out_and_a_miss_starts_over(tmp_path):
    clock = Clock()
    s = store(tmp_path, clock)
    pid = s.add("position-a", **fields()).id
    gaps = []
    for _ in range(MASTERED_STREAK):
        clock.days(40)
        before = clock.now
        p = s.record(pid, solved=True)
        gaps.append((datetime.fromisoformat(p.due) - before).days)
    assert gaps == [3, 7, 14, 30]
    assert s.summary()["mastered"] == 1
    p = s.record(pid, solved=False)
    assert p.streak == 0 and p.lapses == 1 and datetime.fromisoformat(p.due) - clock.now == timedelta(days=1)


def test_the_same_mistake_again_is_the_same_puzzle(tmp_path):
    clock = Clock()
    s = store(tmp_path, clock)
    first = s.add("position-a", **fields())
    s.record(first.id, solved=True)
    again = s.add("position-a", **fields(played="d1h5", played_san="Qh5"))
    assert again.id == first.id and s.summary()["total"] == 1
    assert again.streak == 0 and again.lapses == 1 and again.played_san == "Qh5"


def test_puzzles_are_kept_on_disk(tmp_path):
    clock = Clock()
    pid = store(tmp_path, clock).add("position-a", **fields()).id
    reloaded = store(tmp_path, clock)
    assert reloaded.get(pid).best_san == "exd5"
    assert reloaded.remove(pid) and store(tmp_path, clock).summary()["total"] == 0


def test_the_longest_overdue_comes_first(tmp_path):
    clock = Clock()
    s = store(tmp_path, clock)
    older = s.add("position-a", **fields()).id
    clock.days(1)
    s.add("position-b", **fields())
    clock.days(5)
    assert s.next().id == older
