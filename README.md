# Chess Coach

Play chess against Stockfish while a coach grades every move you make, the way chess.com's coach does.
If you blunder or miss a win (a checkmate, say), the coach stops and offers to let you take the move back
and try again. When you're stuck, ask for a hint. After the game, a review shows your accuracy and lets you
replay your mistakes, and your mistakes come back as puzzles over the following days until you've learned them.

**Design rule:** the engine decides what's true, and the coach only puts it into words. Stockfish does all the
chess, and code turns its analysis into short sentences. Nothing is guessed: every comment and hint restates
something the engine worked out.

**Teaching rule:** you play without running commentary, and the coaching happens around your mistakes: a
retry when you slip, a hint when you ask, and a review afterwards. (Guidance before every move was tried and
dropped: it mostly repeated itself, and telling you a tactic exists spoils the chance to spot it.)

## Setup

You need Python 3.12+, Node 20+, and Stockfish.

```bash
# Stockfish: either install it system-wide...
sudo apt install stockfish
# ...or keep the copy in ./engine/stockfish (git-ignored). Also honoured: STOCKFISH_PATH=/path/to/stockfish

# Backend
cd backend
python3 -m venv .venv            # on Ubuntu this needs: sudo apt install python3-venv
.venv/bin/pip install -r requirements.txt

# The coach's voice, Joe (optional, about 60 MB, downloaded once from huggingface.co/rhasspy/piper-voices):
.venv/bin/python -m piper.download_voices --download-dir ../voices en_US-joe-medium

# Frontend
cd ../frontend
npm install
```

## How the comments work

- **Why a move is bad:** for a bad move, code works out *why* from the engine's line (`facts.why_bad`). The
  move either ignored a piece that was already under attack, put a piece on an attacked square, took away a
  piece's defender, allowed a mate, or missed one. The comment names the piece and the opponent's reply, for
  example "Blunder! 3.Bxe6 puts your bishop on e6, and 3...dxe6 takes it."
- **No spoilers:** when you're offered a retry, the comment doesn't name the better move. "Show me" does
  that, if you want it.

## How much the coach says

By default the coach comments only at **key moments**: your mistakes, blunders and missed wins, your great
moves, missed mates, and finding the right move on a retry. Inaccuracies get a short note. Every move still
gets its grade badge, and the last move's badge sits on the piece that moved, for your moves and the
opponent's, the way chess.com shows it.

Under **⚙ Settings**, set **Coach comments** to "on every move" for a comment on each of your moves.

The newest message is outlined. If you scroll up to reread something, new messages won't pull you away, and
a **↓ Latest** button takes you back.

Turn on **Speak** (the 🔊 button, or under ⚙ Settings) to have the coach read those key comments and
inaccuracy notes, plus your hints, aloud.
- **The voice:** [Piper](https://github.com/OHF-Voice/piper1-gpl), natural-sounding voice models that
  run offline on your CPU. The backend makes the audio and the page plays it, so it works in any browser,
  including the Claude desktop app's, which has no voices of its own.
- **Joe:** the coach always speaks with Joe, a natural US male voice (the Piper model `en_US-joe-medium` in
  `voices/`).
- **Smoother speech:** each comment is spoken at one even volume, with a short pause between sentences
  and a slightly calm pace. (Piper on its own runs sentences together and sets each one's volume
  separately, which sounds choppy.)
- **Notation:** read as words, so "12...Nxe4+" becomes "knight takes e4, check".
- **Pace:** when the coach is reading a comment on your move, the opponent waits until it's finished before
  replying (its move is worked out in the meantime), so the board stays in step with the voice.
- **Interruptions:** only your own move stops what's being read. If the browser pauses a comment on its own,
  it picks up where it left off.
- **Settings:** set `COACH_VOICE=off` to turn the voice off. Without Joe's model, Speak falls back to the
  browser's own voice where there is one.

## Reading moves

The coach writes moves in standard notation: **11.c3** means White's 11th move, a pawn to c3, and
**12...Nxe4** is Black's 12th move, a knight capturing on e4. Every move in a coach message is a link. Point
at it, or tap it, and the board shows the position at that point with an arrow and a caption in words
("White's move 11: pawn from c2 to c3"). That works for lines that never happened in the game too, such as
"after 10...Qxd1 11.Raxd1".

## Coached, graded and unassisted games

In **New game**, choose how much help the game gets. The choice is remembered for the next game.

- **🎓 Coached:** everything on this page: grades, comments, hints, retries and take-backs.
- **📊 Graded:** every move, yours and your opponent's, gets its grade badge, and the evaluation bar shows, but
  there are no hints, comments, retries or take-backs.
- **⚔ Unassisted:** a real game: no hints, take-backs, retries, comments, grades or evaluation while you play.

In graded and unassisted games, **🏳 Resign** gives up the game. Moves are graded either
way, so when the game ends (or you resign) the grades appear, **📊 Game review** shows how it went, and your
mistakes still become puzzles.

## Stepping through the game

**⏮ ◀ ▶ ⏭** above the move list, the ← and → keys, or clicking a move in the list show the board as it was
after that move, with its grade badge and evaluation where the game shows them. Looking back never changes the
game by itself, and an opponent's move doesn't pull you away.

**Taking moves back (coached games):** step back to any earlier position and make a move there, or press
**↩ Play from here** when it's your opponent's move, and everything after it is taken back. In graded and
unassisted games the board stays locked until **⏭** brings you back.

## Hints

Two hint buttons, usable on each of your moves:

- **💡 Hint:** a nudge toward the idea, without naming the piece or the move. It might say there's a
  checkmate, a way to win material, a threat to deal with, or what to aim for in a quiet position: castle
  while your king is still in the center, finish developing, fight for the center, or bring your rooks to
  open files. The priority comes from the engine's best move (`backend/app/guide.py`), and a few details keep
  it accurate:
  - **Threats:** when something of yours is attacked, it checks *how* the engine meets the threat:
    capturing the attacker, moving the piece away, blocking, defending, a check, or a checkmate that makes
    the threat irrelevant. So it won't tell you to save your queen when the better move is to take the
    piece attacking it.
  - **Material:** it only says there's material to win when the engine's evaluation agrees, so a pawn the
    opponent wins straight back doesn't count.
  - **Checks:** it names your king and the checking piece ("Your king on g1 is in check from the knight on
    e2"), and says when the way out is to capture the checking piece.
- **♟ Show piece:** highlights the piece to move on the board. Press it again (**➜ Show move**) and an
  arrow shows where it goes, with a sentence on why the move works.

## Game review

When the game ends, **📊 Game review** appears in the coach panel. **📊 Review** next to the hint buttons
opens it at any point during the game too.

- **Accuracy:** a score from 0 to 100 for you and for the opponent. Each move scores by how much of your
  winning chance it gave away (Lichess's formula). The game score averages the plain mean with the
  harmonic mean, so a couple of blunders pull it down more than a plain average would.
- **Grade counts:** how many great moves, best moves, book moves, inaccuracies, mistakes, misses and
  blunders each side played, under the name of the opening the game reached.
- **Graph:** your winning chances move by move, with a dot on each key moment. Click it, step with
  **⏮ ◀ ▶ ⏭** under it, or use ← and →, to see the position after any move, with the move's badge on the piece
  and the eval bar for that position.
- **Key moments:** your great moves, mistakes, missed wins, blunders and missed mates, with the coach's
  comment on each. Click one to see it on the board. **Show best move** draws the engine's move in green
  next to yours in blue.
- **↻ Retry:** puts the board back to the position before a mistake, so you can look for something better.
  Your try gets graded like any move ("Yes! Best move", or "Mistake" with the reason), and you can try
  again or ask for the best move. This doesn't change the game itself: **← Back to the game** returns to it
  as it was.

## Learn from your mistakes

Every mistake, missed win and blunder you make in a game, and every missed mate, is saved as a puzzle: the
position just before your move, with your move and the engine's. **🧩 Puzzles** in the top right lists them all,
the due ones first, with when each comes back next; the number on it is how many are due. Click one to do it,
or **Start the due puzzles** to go through those in order. Your game waits while you do puzzles, and **♟ Play**
takes you back.

- **Spaced repetition:** a new puzzle comes back the next day. Each time you find the move at the first try,
  the gap grows: 3 days, a week, two weeks, a month, two months, four months. A wrong first try, or asking for
  the solution, brings it back the next day. After four first-try solves in a row it counts as mastered.
- **Solving:** a move counts if it's as good as the engine's or nearly (best, great, excellent, or book). A
  wrong try shows its grade and the reason, and you can try again or see the solution. Only your first answer
  sets the schedule.
- **No giveaways:** the eval bar is hidden while you solve, since it would show whether there's something to
  find.
- **Play on:** once you find the move, the opponent plays on as a graded game (grade badges and the eval bar)
  against the level of your last game, so you can see the idea through. After **Show solution**, play the move
  shown and the opponent plays on the same way. Your game in Play isn't touched, and mistakes made playing on
  become puzzles too.
- **Repeats:** making the same mistake in the same position in another game doesn't add a second puzzle; it
  starts that puzzle's schedule over.
- **Doing one early:** any puzzle in the list can be done before it's due; it counts toward its schedule the
  same way. **Remove this puzzle** deletes one.
- **Where they're kept:** `progress/puzzles.json` in the project folder (git-ignored), so they last across
  games and browsers. Set `COACH_PROGRESS_DIR` to keep them somewhere else.

## Learn openings

**📚 Openings** (top right) is for learning openings from Lichess's list of named lines.

- **Choosing one:** popular openings are grouped For White, Against 1.e4 and Against 1.d4, and the search box
  finds any of the 3,865 named lines by name or ECO code (try "Najdorf" or "C50").
- **Exploring:** the board shows the opening's position, with its moves above it (click one, or use **⏮ ◀ ▶ ⏭**
  and ← → to step through). **Book moves from here** lists every move that stays in a named line, the most
  played first, with the line it leads to and how many named lines go through it. Point at one to see it on
  the board, click it to play it, or make any move on the board yourself. The eval bar shows the engine's view
  of each position. Positions are matched rather than move orders, so transpositions are still in book.
- **Practising:** **▶ Practise as White/Black** plays the opening from the start. You play your side's book
  moves from memory; the computer plays the other side's, picking among its book moves at random with the main
  lines most likely, so each run can go a different way. A move that isn't a book move of this opening gets
  "Try again" (**Show me** draws the book move), and the run ends when the opening's named lines do, with a count
  of your mistakes. Practice follows the lines' own move orders, and the eval bar stays hidden.
- **Going over a line:** after a run, **Go over this line** goes back to where the variations began, with the
  line you played ahead of you: step through it with ▶ and see, at each move, the other book moves you could
  have met (the move from your line is marked "this line").
- **My repertoire (spaced repetition):** **☆ Add to my repertoire** as White or Black keeps an opening in My
  repertoire, at the top of the Openings page (the number on **📚 Openings** is how many are due). It's due
  straight away; after that, each completed practice run of a due opening is a review: a clean run brings it
  back later than last time (a day, then 3 days, a week, two weeks, …), and any mistake (asking to be shown a
  move counts as one) brings it back the next day. Practising one that isn't due doesn't change its schedule.
  Because the computer varies its replies, the reviews cover the different variations over time. Kept in
  `progress/repertoire.json` (git-ignored).
- **Playing it out:** **♟ Play from here** (on any position you're exploring) and **♟ Play on from here** (at
  the end of a practice run) start a game against the computer from that position, in Play, at your last
  game's level and in your usual mode, so you practise the middlegame the opening leads to. If a game is in
  progress, it asks before replacing it.

## Saved games

**💾 Save game** at the top of the game review keeps the game, review and all, in **📁 Saved** (top right,
next to Play and Puzzles). The list shows who each game was against, when, how it ended, the opening and both
accuracies. **Open review** brings the whole review back (graph, key moments, Retry, stepping through the
moves), and **Delete** removes a game after asking. Saved games are kept in `progress/games.json`
(git-ignored), next to the puzzles.

## Run

```bash
./dev.sh
```

Then open http://localhost:5173. The backend listens on http://127.0.0.1:8000, and Vite forwards `/api` to it.

## Tests

```bash
cd backend && .venv/bin/python -m pytest
```

- `tests/test_grading.py` checks the grading rules using made-up engine output.
- `tests/test_api.py` runs real positions through Stockfish, for example a hung queen, allowing mate,
  and missing mate in one.
- `tests/test_facts.py` checks why bad moves are bad, including positions from real games.
- `tests/test_advice.py` checks what each hint level reveals.
- `tests/test_guide.py` checks the hints' priority for a position: the right topic, threats and checks met
  the way the engine meets them, and never the move itself.
- `tests/test_openings.py` checks opening names and book moves (including transpositions and the traps in
  the list), search, and the book moves offered when exploring and practising an opening.
- `tests/test_puzzles.py` checks the puzzle schedule (with a fake clock), repeats, and saving to disk.
- `tests/test_games.py` checks saving, listing and deleting saved games.
- `tests/test_repertoire.py` checks the opening repertoire's schedule (with a fake clock).

## How moves are graded

Every position is analysed at depth 18 with the top 3 lines (MultiPV 3). Engine scores are converted to a win
chance from 0 to 100% using the curve Lichess uses for accuracy. A move's grade depends on how much win
chance it gave up compared with the best move:

| Win% lost | Grade |
|---|---|
| 0 (engine's top move) | **Best**, or **Great** if every alternative was ≥10% worse |
| < 2 | Excellent |
| < 5 | Good |
| < 10 | Inaccuracy |
| < 20 | Mistake |
| ≥ 20 | Blunder |

There are also four special cases:
- **Book:** opening theory. If the position after the move is on one of the 3,865 named lines in Lichess's
  openings list, and the engine grades the move good or better, it's marked 📖 Book. Positions are matched,
  not move orders, so a transposition into theory counts. The list includes traps such as "Barnes Opening:
  Fool's Mate", so a book move the engine calls an inaccuracy or worse keeps that grade (2.g4 is still a
  blunder). The opening the game has reached is shown next to the title, for example "📖 Italian Game:
  Two Knights Defense", and stays after the game leaves theory.
- **Forced:** you had only one legal move.
- **Missed win:**
  - there was a forced mate in 3 or fewer and you didn't play it, or
  - a winning move was available (≥70%), but you played something that only keeps the game level (≥40%).

  If the move also threw the game away, it's graded a blunder instead, and the comment mentions the
  missed mate.
- **Retry offer:** you get one for a mistake, a missed win or a blunder. The *Offer a retry after* setting
  controls which of those trigger it.

The opponent's moves are graded too. When the opponent blunders, the coach tells you there's something to find.

Thresholds are constants at the top of `backend/app/grading.py`.

## Layout

```
backend/app/
  main.py      FastAPI routes: /api/levels, /api/config, /api/analyze, /api/grade, /api/bot-move,
               /api/hint, /api/puzzles..., /api/games..., /api/openings..., /api/repertoire...,
               /api/speech
  engine.py    Two Stockfish processes (analysis + opponent), position cache, null-move threat search
  grading.py   win%, material counting, classification -> MoveGrade
  facts.py     Why a bad move is bad, and whether a threat is real, from the engine's lines
  coach.py     The coach's comments on your moves
  advice.py    Hints, by level
  guide.py     What matters in a position, for the 💡 Hint
  speech.py    The coach's voice (Joe): text to speech with Piper
  openings.py  Opening names, book moves, and the opening tree for learning openings
  puzzles.py   Puzzles from your mistakes, with spaced repetition
  games.py     Games saved from the review
  repertoire.py  Your opening repertoire, with spaced repetition
  levels.py    Opponent strength presets
  config.py    Settings from env vars (COACH_ANALYSIS_DEPTH, COACH_ENGINE_THREADS, ...)
backend/data/openings/  Lichess's openings list (a.tsv ... e.tsv: ECO code, name, moves)
frontend/src/
  useCoachGame.ts       Game state: turns, grading, retry / take-back flow, hints, key moments
  review.ts             Game review: accuracy, grade counts, key moments
  useReviewPractice.ts  Retrying a move from the review without touching the game
  usePuzzles.ts         Puzzles from your mistakes: the current one, your tries, and its schedule
  useSavedGames.ts      Saved games: the list, the one open, saving and deleting
  useOpenings.ts        Learning openings: choosing one, exploring its book moves, practising it
  voice.ts              Playing the coach's voice, with notation turned into words
  moveRefs.ts           Finding the moves a coach message mentions, so they can be shown on the board
  components/           Board, EvalBar, CoachPanel, GameReview, PuzzlePanel, SavedGames, OpeningsPanel,
                        MoveList, NewGame
```

The API is stateless. The client sends the whole move list (UCI, starting from the initial position) with every
request, and the server caches analysis by position.

## Roadmap

1. ~~Playable game against Stockfish at adjustable strength~~
2. ~~Move grading, eval bar, take-backs and "try again"~~
3. ~~Hints that reveal a little more each time~~ (guidance before every move was tried, then dropped)
4. ~~Game review: accuracy, grade counts, eval graph, and retrying your mistakes~~
5. ~~Opening names and book moves~~
6. ~~Puzzles from your own mistakes, with spaced repetition~~
7. ~~Saved games~~

The opening names come from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings),
which is in the public domain (CC0).

Claude once wrote the comments from an engine fact sheet, with a chat for questions. It was removed: the
engine-based wording turned out to be more reliable.
