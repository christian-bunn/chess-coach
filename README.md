# Chess Coach

Play chess against Stockfish while a coach grades every move you make, the way chess.com's coach does.
If you blunder or miss a win (a checkmate, say), the coach stops and offers to let you take the move back
and try again. When you're stuck, ask for a hint, or ask the coach a question about the position.

**Design rule:** the engine decides what's true, and the coach only puts it into words. Stockfish does all the
chess. Claude writes the comments from a fact sheet the engine produces, and is told not to work anything
out on its own.

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

# The coach's voice (optional, ~60 MB, downloaded once from huggingface.co/rhasspy/piper-voices)
.venv/bin/python -m piper.download_voices --download-dir ../voices en_US-lessac-medium

# Frontend
cd ../frontend
npm install
```

## Claude explanations (optional)

Without Claude, the coach uses short built-in comments. There are two ways to have Claude explain every
move, both yours and the opponent's. The footer under the coach panel shows which one is in use.

### On your Claude plan, through Claude Code (default)

Log Claude Code's command-line tool in with your Claude account once. This opens a browser to sign in:

```bash
claude auth login --claudeai
```

Then restart `./dev.sh`. The coach runs `claude -p` for each comment, so comments come out of your plan's
usage limits rather than an API bill. A game is roughly 60–80 short requests. Comments use the Haiku
model by default, which is quick and light on your limits; set `COACH_MODEL=sonnet` for richer ones.

Some safeguards apply in this mode:
- **Never bills an API key:** the coach removes `ANTHROPIC_API_KEY` from Claude Code's environment,
  because with a key set, `claude -p` bills the key instead of your plan. It also refuses to run if
  Claude Code is logged in with anything other than a Claude subscription.
- **Lightweight:** each run has no tools, runs in an empty temporary folder, and saves no session history.

**Personal use only:** this runs the unmodified Claude Code program under your own login, on your own
machine. Anthropic's terms don't allow apps that route other people's requests through your Claude
plan, so don't host or share the coach in this mode. Use an API key for that.

### With an API key (billed per request)

An API key from console.anthropic.com is billed separately from any Claude plan. Put it in a `.env` file
in the project folder (git-ignored, read by the backend at startup):

```bash
ANTHROPIC_API_KEY=sk-ant-...
COACH_AI=api
```

`COACH_AI=api` is needed only if Claude Code is also logged in, because Claude Code is tried first. With
the default model, Opus 5.5, each comment costs roughly 1¢ (about $1 for a 40-move game); Haiku is about
40× cheaper. These are estimates. API requests opt in to server-side refusal fallbacks
(`fallbacks: "default"`), so if a safety classifier ever declined a comment, the API would retry it on
another model.

### Settings

These can go in `.env` or the environment:

| Setting | Default | |
|---|---|---|
| `COACH_AI` | `auto` | `auto`: Claude Code if it's logged in, else an API key if there is one, else built-in comments. Also `claude-code`, `api`, or `off` |
| `COACH_MODEL` | `haiku` (Claude Code), `claude-opus-5-5` (API) | e.g. `sonnet`, `claude-haiku-5-5` |
| `COACH_EFFORT` | `low` | How much Claude thinks before commenting: `low`, `medium`, `high`, ... |

### How it works

- **The main point:** for a bad move, code works out *why* before Claude sees anything. The move either
  ignored a piece that was already under attack, put a piece on an attacked square, took away a piece's
  defender, allowed a mate, or missed one (`facts.why_bad`). The comment is built around that. The built-in
  comments use the same reasons.
- **The fact sheet:** `backend/app/facts.py` turns the engine's analysis into plain sentences. It covers
  what the move does and attacks, the threat it creates, the engine's lines spelled out move by move,
  loose pieces, and mate facts. Claude gets only this sheet, never a chance to analyse the board itself.
- **No spoilers:** while you're being offered a retry, the best move (and anything that points at it) is
  left out of the sheet entirely, so the comment can't give the answer away. The same goes for your
  best reply when the opponent blunders.
- **Streaming:** comments stream into the coach panel. If Claude fails or is slow, you keep the built-in
  comment.

## How much the coach says

By default the coach speaks up only at **key moments**. Every move still gets its grade badge, but full
comments are kept for:
- your mistakes, blunders and missed wins;
- your great moves, missed mates, and finding the right move on a retry;
- opponent moves that create a real threat ("Watch out: your queen on h5 is under attack") or that you can
  punish.

Inaccuracies get a short built-in note. Under **⚙ Settings**, set **Coach comments** to "on every move" for a
comment on everything (that uses more of your plan).

The newest message is outlined. If you scroll up to reread something, new messages won't pull you away, and
a **↓ Latest** button takes you back.

Turn on **Speak** (the 🔊 button, or under ⚙ Settings) to have the coach read those key comments, plus your
hints and answers, aloud.
- **The voice:** [Piper](https://github.com/OHF-Voice/piper1-gpl), a natural-sounding voice model that
  runs offline on your CPU. The backend makes the audio and the page plays it, so it works in any browser,
  including the Claude desktop app's, which has no voices of its own.
- **Notation:** read as words, so "12...Nxe4+" becomes "knight takes e4, check".
- **Interruptions:** anything still being read stops as soon as you move.
- **Choosing a voice:** set `COACH_VOICE` to another voice name from piper-voices, after downloading it the
  same way, or to `off`. Without the voice model, Speak falls back to the browser's own voice where there
  is one.

## Take back and Forward

**↶ Take back** (or the ← key) undoes your last move and the opponent's reply. **Forward ↷** (or →) puts
them back, grades and all. You can step back several moves and forward again. Playing a different move
starts a new line, and Forward then has nothing to replay.

## Hints and questions

**Hint button:** each press on the same move reveals a little more:

1. **The idea:** there's a checkmate, a way to win material, a threat to deal with, or nothing tactical. It
   can also tell you that the material you're trying to save can't be kept.
2. **The piece** to move, and whether the move is a capture or a check.
3. **The move itself,** with an arrow on the board.

Each level's facts contain only what that level may reveal, so a level-1 hint can't name the piece even by
accident. Hints work without Claude too, using built-in text.

**Questions** (needs Claude): type things like "what about Nf5?", "is my knight safe?", "can I castle?" or
"why was that a blunder?".
- **Mentioned moves get checked:** if you name moves (in notation, or as "knight to f5"), the engine
  evaluates up to three of them first, and the coach answers from those results.
- **Illegal moves:** if a move you name isn't possible, it says so.
- **No unrequested answers:** the engine's best moves are only shared when you ask what to play, and the
  coach won't reveal the move you're retrying.
- **Engine verdict:** answers include the same one-line verdict the hints use, such as "you can't keep the
  pawn on d5, so develop instead", which keeps the advice consistent.
- **Usage:** each hint or question is one short request on your plan.

## Run

```bash
./dev.sh
```

Then open http://localhost:5173. The backend listens on http://127.0.0.1:8000, and Vite forwards `/api` to it.

## Tests

```bash
cd backend && .venv/bin/python -m pytest
```

`tests/test_grading.py` checks the grading rules using made-up engine output. `tests/test_api.py` runs real
positions through Stockfish, for example a hung queen, allowing mate, and missing mate in one.
`tests/test_facts.py` checks the fact sheet, including that hidden answers really are absent.
`tests/test_advice.py` checks what each hint level reveals and how moves are spotted in questions.
`tests/test_explain.py` covers the API path, using a fake client plus the real SDK over a mock transport.
`tests/test_claude_code.py` covers the Claude Code path against a fake `claude` program. The test suite
never calls Claude, so it spends neither plan usage nor API credit.

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

There are also three special cases:
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
               /api/explain, /api/hint, /api/ask
  engine.py    Two Stockfish processes (analysis + opponent), position cache, null-move threat search
  grading.py   win%, material counting, classification -> MoveGrade
  facts.py     The plain-language fact sheet Claude explains from
  advice.py    Facts for hints (by level) and for questions, and spotting moves named in a question
  prompts.py   System prompts for move comments, hints and questions
  explain.py   Claude through the API (system prompt, streaming, refusal fallback)
  claude_code.py  Claude through Claude Code's headless mode, on your Claude plan
  speech.py    The coach's voice: text to speech with Piper
  coach.py     Built-in comment templates (fallback when Claude isn't available)
  levels.py    Opponent strength presets
  config.py    Settings from env vars (COACH_ANALYSIS_DEPTH, COACH_ENGINE_THREADS, ...)
frontend/src/
  useCoachGame.ts   Game state: turns, grading, retry / take-back flow, hints, questions, key moments
  voice.ts          Playing the coach's voice, with notation turned into words
  components/       Board, EvalBar, CoachPanel, MoveList, NewGame
```

The API is stateless. The client sends the whole move list (UCI, starting from the initial position) with every
request, and the server caches analysis by position.

## Roadmap

1. ~~Playable game against Stockfish at adjustable strength~~
2. ~~Move grading, eval bar, take-backs and "try again"~~
3. ~~Claude writes the explanations, using the engine facts in each `MoveGrade`~~
4. ~~Hints that reveal a little more each time, and a chat where you can ask the coach questions (the coach checks
   answers with the engine)~~
5. End-of-game review, accuracy score, opening names, saved games
