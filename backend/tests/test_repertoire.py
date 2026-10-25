"""The opening repertoire: due when added, and spaced repetition from clean practice runs."""

from datetime import UTC, datetime, timedelta

from app.repertoire import RepertoireStore

ITALIAN = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]


class Clock:
    def __init__(self):
        self.now = datetime(2026, 10, 25, 9, 0, tzinfo=UTC)

    def __call__(self):
        return self.now


def test_added_openings_are_due_now_and_not_added_twice(tmp_path):
    store = RepertoireStore(tmp_path / "repertoire.json", Clock())
    entry = store.add("Italian Game", "C50", ITALIAN, "white")
    assert store.summary() == {"total": 1, "due": 1, "mastered": 0}
    assert store.add("Italian Game", "C50", ITALIAN, "white").id == entry.id
    assert store.add("Italian Game", "C50", ITALIAN, "black").id != entry.id  # the other side is its own entry


def test_clean_runs_spread_reviews_out_and_mistakes_bring_it_back(tmp_path):
    clock = Clock()
    store = RepertoireStore(tmp_path / "repertoire.json", clock)
    eid = store.add("Italian Game", "C50", ITALIAN, "white").id
    gaps = []
    for _ in range(4):
        before = clock.now
        entry, counted = store.review(eid, mistakes=0)
        assert counted
        gaps.append((datetime.fromisoformat(entry.due) - before).days)
        clock.now = datetime.fromisoformat(entry.due)
    assert gaps == [1, 3, 7, 14]
    entry, counted = store.review(eid, mistakes=2)
    assert counted and entry.streak == 0 and entry.lapses == 1 and entry.last_mistakes == 2
    assert datetime.fromisoformat(entry.due) - clock.now == timedelta(days=1)


def test_practising_before_its_due_doesnt_count(tmp_path):
    clock = Clock()
    store = RepertoireStore(tmp_path / "repertoire.json", clock)
    eid = store.add("Italian Game", "C50", ITALIAN, "white").id
    store.review(eid, mistakes=0)  # due again tomorrow
    entry, counted = store.review(eid, mistakes=0)
    assert not counted and entry.streak == 1 and entry.reviews == 1


def test_kept_on_disk(tmp_path):
    store = RepertoireStore(tmp_path / "repertoire.json", Clock())
    eid = store.add("Sicilian Defense", "B20", ["e2e4", "c7c5"], "black").id
    again = RepertoireStore(tmp_path / "repertoire.json", Clock())
    assert again.get(eid).side == "black"
    assert again.remove(eid) and RepertoireStore(tmp_path / "repertoire.json").list() == []
