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

# The coach's voice (optional, downloaded once from huggingface.co/rhasspy/piper-voices):
# Ryan is the default (120 MB); add any other voices you'd like to choose from in Settings
.venv/bin/python -m piper.download_voices --download-dir ../voices en_US-ryan-high

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
- **Choosing a voice:** pick one under **⚙ Settings → Voice**, and use **▶ Test** to hear it. Every model
  in `voices/` is listed. The default is Ryan, the high-quality male US voice; Joe, Norman and Lessac are
  the others downloaded so far.
- **Smoother speech:** each comment is spoken at one even volume, with a short pause between sentences
  and a slightly calm pace. (Piper on its own runs sentences together and sets each one's volume
  separately, which sounds choppy.)
- **Notation:** read as words, so "12...Nxe4+" becomes "knight takes e4, check".
- **Pace:** when the coach is reading a comment on your move, the opponent waits until it's finished before
  replying (its move is worked out in the meantime), so the board stays in step with the voice.
- **Interruptions:** only your own move stops what's being read. If the browser pauses a comment on its own,
  it picks up where it left off.
- **Settings:** set `COACH_VOICE` to a voice name to change the default, or to `off`. Without any voice
  models, Speak falls back to the browser's own voice where there is one.

## Reading moves

The coach writes moves in standard notation: **11.c3** means White's 11th move, a pawn to c3, and
**12...Nxe4** is Black's 12th move, a knight capturing on e4. Every move in a coach message is a link. Point
at it, or tap it, and the board shows the position at that point with an arrow and a caption in words
("White's move 11: pawn from c2 to c3"). That works for lines that never happened in the game too, such as
"after 10...Qxd1 11.Raxd1".

## Take back and Forward

**↶ Take back** (or the ← key) undoes your last move and the opponent's reply. **Forward ↷** (or →) puts
them back, grades and all. You can step back several moves and forward again. Playing a different move
starts a new line, and Forward then has nothing to replay.

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
- **Graph:** your winning chances move by move, with a dot on each key moment. Click it, or use ← and →,
  to see the position after any move, with the move's badge on the piece and the eval bar for that position.
- **Key moments:** your great moves, mistakes, missed wins, blunders and missed mates, with the coach's
  comment on each. Click one to see it on the board. **Show best move** draws the engine's move in green
  next to yours in blue.
- **↻ Retry:** puts the board back to the position before a mistake, so you can look for something better.
  Your try gets graded like any move ("Yes! Best move", or "Mistake" with the reason), and you can try
  again or ask for the best move. This doesn't change the game itself: **← Back to the game** returns to it
  as it was.

## Learn from your mistakes

Every mistake, missed win and blunder you make in a game, and every missed mate, is saved as a puzzle: the
position just before your move, with your move and the engine's. **🧩 Puzzles** in the top right switches to
them; the number on it is how many are due. Your game waits while you do puzzles, and **♟ Play** takes you back.

- **Spaced repetition:** a new puzzle comes back the next day. Each time you find the move at the first try,
  the gap grows: 3 days, a week, two weeks, a month, two months, four months. A wrong first try, or asking for
  the solution, brings it back the next day. After four first-try solves in a row it counts as mastered.
- **Solving:** a move counts if it's as good as the engine's or nearly (best, great, excellent, or book). A
  wrong try shows its grade and the reason, and you can try again or see the solution. Only your first answer
  sets the schedule.
- **No giveaways:** the eval bar is hidden while you solve, since it would show whether there's something to
  find.
- **Repeats:** making the same mistake in the same position in another game doesn't add a second puzzle; it
  starts that puzzle's schedule over.
- **Nothing due:** **Do one early** brings forward the one due soonest. **Remove this puzzle** deletes one.
- **Where they're kept:** `progress/puzzles.json` in the project folder (git-ignored), so they last across
  games and browsers. Set `COACH_PROGRESS_DIR` to keep them somewhere else.

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
- `tests/test_openings.py` checks opening names and book moves, including transpositions and the traps in
  the list.
- `tests/test_puzzles.py` checks the puzzle schedule (with a fake clock), repeats, and saving to disk.

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
               /api/hint, /api/puzzles..., /api/speech, /api/voices
  engine.py    Two Stockfish processes (analysis + opponent), position cache, null-move threat search
  grading.py   win%, material counting, classification -> MoveGrade
  facts.py     Why a bad move is bad, and whether a threat is real, from the engine's lines
  coach.py     The coach's comments on your moves
  advice.py    Hints, by level
  guide.py     What matters in a position, for the 💡 Hint
  speech.py    The coach's voice: text to speech with Piper
  openings.py  Opening names and book moves, from Lichess's openings list
  puzzles.py   Puzzles from your mistakes, with spaced repetition
  levels.py    Opponent strength presets
  config.py    Settings from env vars (COACH_ANALYSIS_DEPTH, COACH_ENGINE_THREADS, ...)
backend/data/openings/  Lichess's openings list (a.tsv ... e.tsv: ECO code, name, moves)
frontend/src/
  useCoachGame.ts       Game state: turns, grading, retry / take-back flow, hints, key moments
  review.ts             Game review: accuracy, grade counts, key moments
  useReviewPractice.ts  Retrying a move from the review without touching the game
  usePuzzles.ts         Puzzles from your mistakes: the current one, your tries, and its schedule
  voice.ts              Playing the coach's voice, with notation turned into words
  moveRefs.ts           Finding the moves a coach message mentions, so they can be shown on the board
  components/           Board, EvalBar, CoachPanel, GameReview, PuzzlePanel, MoveList, NewGame
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
7. Saved games

The opening names come from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings),
which is in the public domain (CC0).

Claude once wrote the comments from an engine fact sheet, with a chat for questions. It was removed: the
engine-based wording turned out to be more reliable.
