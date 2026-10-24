import { Chess } from 'chess.js'
import { useMemo, useRef, useState } from 'react'
import { api, type Classification, type Eval, type Level, type MoveGrade } from './api'
import { GOOD_GRADES } from './grades'
import { speak, stopSpeaking, whenQuiet } from './voice'

export type Side = 'white' | 'black'
/**
 * setup:    choosing color and level
 * user:     waiting for the user's move
 * grading:  the user's move is being analysed
 * decision: the coach suggested taking the move back; waiting for "try again" / "continue"
 * bot:      the opponent is thinking
 * over:     game finished
 * error:    a request failed; the user can retry it
 */
export type Phase = 'setup' | 'user' | 'grading' | 'decision' | 'bot' | 'over' | 'error'
/** Which of the user's moves make the coach pause and offer a take-back. */
export type RetryMode = 'mistakes' | 'blunders' | 'off'
/** 'key': the coach only comments at key moments (see isKeyMove). 'all': it comments on every move. */
export type CoachMode = 'key' | 'all'
/**
 * How much help a game gets:
 * coached:    grades, comments, hints, retries and take-backs
 * graded:     every move's grade and the eval bar, but nothing else (no hints, comments, retries or take-backs)
 * unassisted: a real game: no help at all until it's over (moves are still graded quietly, for the review)
 */
export type Assistance = 'coached' | 'graded' | 'unassisted'
const ASSISTANCE: readonly Assistance[] = ['coached', 'graded', 'unassisted']

export interface Ply {
  uci: string
  san: string
  grade: MoveGrade | null
}

export interface CoachMessage {
  id: number
  kind: 'grade' | 'info' | 'over' | 'error' | 'hint'
  text: string
  /** Shown before the comment, e.g. "You found it!". */
  prefix?: string
  /** True while the text is still being fetched (hints and guidance). */
  loading?: boolean
  /** For hints: which level (1-3). */
  hintLevel?: number
  /** Read aloud (when the voice is on) once its text is final. */
  speak?: boolean
  /** The game (UCI moves) when the message was written, so the moves it mentions can be shown on the board. */
  context?: string[]
  grade?: MoveGrade
}

/** The game as it stood when the review was opened. Practising moves in the review doesn't change it. */
export interface ReviewSnapshot {
  plies: Ply[]
  evals: (Eval | null)[]
  userColor: Side
  /** How the game ended, or null if it's still going. */
  result: string | null
}

interface GameState {
  userColor: Side
  level: Level | null
  plies: Ply[]
  /** evals[n] is the evaluation after n plies; null until the engine has looked at it. */
  evals: (Eval | null)[]
  phase: Phase
  messages: CoachMessage[]
  /** The graded move the coach is offering to take back. */
  pendingRetry: MoveGrade | null
  /** Set while the user is retrying a move, so finding the right one can be celebrated. */
  retryingPly: number | null
  hintArrow: { from: string; to: string } | null
  /** How many hint levels the student has used, and at which position (number of plies). */
  /** Hints used at the position with `at` plies: the idea, and how far "show piece" has gone (piece, then move). */
  hints: { at: number; idea: boolean; piece: 0 | 1 | 2 }
  /** The piece the "show piece" hint is pointing at, highlighted on the board. */
  pieceHint: string | null
  /** What Take back removed, most recent last, so Forward can put it back (until a new move is made). */
  redo: { plies: Ply[]; evals: (Eval | null)[] }[]
  failed: 'grade' | 'bot' | null
  retryMode: RetryMode
  coachMode: CoachMode
  voice: boolean
  review: ReviewSnapshot | null
  reviewOpen: boolean
  assistance: Assistance
  /** The student resigned. */
  resigned: boolean
}

const SETTING_KEYS = {
  retryMode: 'chess-coach.retry-mode',
  coachMode: 'chess-coach.coach-mode',
  voice: 'chess-coach.voice',
  assistance: 'chess-coach.assistance',
  legacyAssisted: 'chess-coach.assisted', // "on"/"off", before Graded games existed
}

function loadSetting<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const saved = localStorage.getItem(key)
    if (saved !== null && (allowed as readonly string[]).includes(saved)) return saved as T
  } catch {
    // storage unavailable: fall through to the default
  }
  return fallback
}

function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // not persisted; fine
  }
}

// The student's moves that become puzzles to practise later (the backend makes sure).
const PUZZLE_GRADES: ReadonlySet<Classification> = new Set(['mistake', 'miss', 'blunder'])

// Moves of the student's that the coach always comments on (and reads aloud), even in 'key' mode.
const KEY_GRADES: ReadonlySet<Classification> = new Set(['great', 'mistake', 'miss', 'blunder'])

function isKeyMove(grade: MoveGrade, foundOnRetry: boolean): boolean {
  return foundOnRetry || KEY_GRADES.has(grade.classification) || grade.delivers_mate || grade.missed_mate_in !== null
}

let nextMessageId = 1
function message(
  kind: CoachMessage['kind'],
  text: string,
  grade?: MoveGrade,
  extra?: Partial<Pick<CoachMessage, 'prefix' | 'loading' | 'hintLevel' | 'speak' | 'context'>>,
): CoachMessage {
  return { id: nextMessageId++, kind, text, grade, ...extra }
}

function toMove(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }
}

export function buildGame(plies: Ply[]): Chess {
  const game = new Chess()
  for (const ply of plies) game.move(toMove(ply.uci))
  return game
}

/** "12. Nf3" or "12... Nf6" for the move at 0-based ply index `index`. */
export function moveLabel(index: number, san: string): string {
  return `${Math.floor(index / 2) + 1}.${index % 2 === 0 ? '' : '..'} ${san}`
}

function gameOverText(game: Chess, userColor: Side): string | null {
  if (game.isCheckmate()) {
    return game.turn() === userColor[0] ? 'Checkmate. Your opponent wins this one.' : 'Checkmate. You win!'
  }
  if (game.isStalemate()) return 'Stalemate. The game is a draw.'
  if (game.isInsufficientMaterial()) return "Draw: neither side has enough material left to checkmate."
  if (game.isThreefoldRepetition()) return 'Draw by threefold repetition.'
  if (game.isDrawByFiftyMoves()) return 'Draw by the 50-move rule.'
  return null
}

const RESIGNED = 'You resigned. Your opponent wins this one.'

function wantsRetry(grade: MoveGrade, mode: RetryMode): boolean {
  if (!grade.retry_suggested || mode === 'off') return false
  return mode === 'mistakes' || grade.classification === 'blunder' || grade.classification === 'miss'
}

function retryHint(grade: MoveGrade): string {
  if (grade.missed_mate_in === 1) return "There's checkmate in one move here. Look at every check you can give."
  if (grade.missed_mate_in) return `There's a forced checkmate in ${grade.missed_mate_in} here. Start by looking at checks.`
  if (grade.allows_mate_in) return "Find a move that doesn't let your opponent checkmate you."
  if (grade.material_change < 0) {
    return "Find a move that doesn't give away material. Before you move, ask what your opponent can capture."
  }
  if (grade.classification === 'miss') return "There's a much stronger move here. Look for checks, captures and threats."
  return 'Take another look. What does your opponent threaten, and what can you attack?'
}

const INITIAL: GameState = {
  userColor: 'white',
  level: null,
  plies: [],
  evals: [null],
  phase: 'setup',
  messages: [],
  pendingRetry: null,
  retryingPly: null,
  hintArrow: null,
  hints: { at: 0, idea: false, piece: 0 },
  pieceHint: null,
  redo: [],
  failed: null,
  retryMode: 'mistakes',
  coachMode: 'key',
  voice: false,
  review: null,
  reviewOpen: false,
  assistance: 'coached',
  resigned: false,
}

/** `onPuzzleSaved`: called when one of the student's moves has been saved as a puzzle. */
export function useCoachGame(onPuzzleSaved?: () => void) {
  const [state, setState] = useState<GameState>(() => ({
    ...INITIAL,
    retryMode: loadSetting(SETTING_KEYS.retryMode, ['mistakes', 'blunders', 'off'], 'mistakes'),
    coachMode: loadSetting(SETTING_KEYS.coachMode, ['key', 'all'], 'key'),
    voice: loadSetting(SETTING_KEYS.voice, ['on', 'off'], 'off') === 'on',
    assistance: loadSetting(
      SETTING_KEYS.assistance,
      ASSISTANCE,
      loadSetting(SETTING_KEYS.legacyAssisted, ['on', 'off'], 'on') === 'off' ? 'unassisted' : 'coached',
    ),
  }))
  // Async handlers read and write through this ref so they never act on a stale snapshot.
  const stateRef = useRef(state)
  const update = (fn: (s: GameState) => GameState) => {
    stateRef.current = fn(stateRef.current)
    setState(stateRef.current)
  }

  // Aborting this cancels every in-flight request (on undo / new game) so late replies are ignored.
  const pending = useRef(new AbortController())
  const cancelPending = () => {
    pending.current.abort()
    pending.current = new AbortController()
  }

  // Hints and guidance being fetched. Only a new game cancels them: after a take-back, a hint that
  // arrives late is still posted (though it isn't shown on the board any more).
  const replies = useRef(new AbortController())
  const onPuzzleSavedRef = useRef(onPuzzleSaved)
  onPuzzleSavedRef.current = onPuzzleSaved

  /** Read message `id` aloud if it's meant to be and the voice is on. */
  const announce = (id: number) => {
    const m = stateRef.current.messages.find((m) => m.id === id)
    if (m?.speak && stateRef.current.voice) speak((m.prefix ?? '') + m.text)
  }

  const editMessage = (id: number, fn: (m: CoachMessage) => CoachMessage | null) =>
    update((s) => ({ ...s, messages: s.messages.flatMap((m) => (m.id === id ? (fn(m) ?? []) : [m])) }))

  /**
   * Fill message `id` (posted with `loading`) with the text `request` comes back with. If it fails,
   * `fallback` is shown instead; with no fallback the message is removed.
   */
  const fill = async (id: number, request: (signal: AbortSignal) => Promise<string>, fallback?: string) => {
    const signal = replies.current.signal
    let text: string | undefined
    try {
      text = await request(signal)
    } catch {
      text = fallback
    }
    if (signal.aborted) return
    editMessage(id, (m) => (text ? { ...m, text, loading: false } : null))
    announce(id)
  }

  const fail = (error: unknown, what: 'grade' | 'bot') => {
    const reason = error instanceof Error ? error.message : String(error)
    update((s) => ({
      ...s,
      phase: 'error',
      failed: what,
      messages: [...s.messages, message('error', `I couldn't reach the engine (${reason}).`)],
    }))
  }

  /** Enter `next` unless the game just ended. */
  const finishTurn = (s: GameState, next: Phase): GameState => {
    const over = gameOverText(buildGame(s.plies), s.userColor)
    if (!over) return { ...s, phase: next }
    if (s.voice && s.assistance === 'coached') speak(over)
    return { ...s, phase: 'over', messages: [...s.messages, message('over', over)] }
  }

  const runBot = async () => {
    const signal = pending.current.signal
    update((s) => ({ ...s, phase: 'bot', failed: null }))
    const { plies, level } = stateRef.current
    try {
      // The opponent waits until the comment on the student's move has been read, so the board stays in step
      // with the voice. Its move is worked out in the meantime.
      const [grade] = await Promise.all([api.botMove(plies.map((p) => p.uci), level?.id ?? 'casual', signal), whenQuiet(signal)])
      if (signal.aborted) return
      update((s) =>
        finishTurn(
          {
            ...s,
            plies: [...s.plies, { uci: grade.uci, san: grade.san, grade }],
            evals: [...s.evals.slice(0, grade.ply), grade.eval_after],
          },
          'user',
        ),
      )
    } catch (error) {
      if (!signal.aborted) fail(error, 'bot')
    }
  }

  const continueGame = () => {
    update((s) => finishTurn({ ...s, pendingRetry: null }, 'bot'))
    if (stateRef.current.phase === 'bot') void runBot()
  }

  const gradeLastMove = async () => {
    const signal = pending.current.signal
    update((s) => ({ ...s, phase: 'grading', failed: null }))
    const { plies } = stateRef.current
    try {
      const grade = await api.grade(plies.map((p) => p.uci), signal)
      if (signal.aborted) return
      const { retryingPly, retryMode, coachMode, assistance } = stateRef.current
      const coached = assistance === 'coached'
      const found = retryingPly === grade.ply && GOOD_GRADES.has(grade.classification)
      const offerRetry = coached && wantsRetry(grade, retryMode)
      const key = isKeyMove(grade, found)
      // In 'key' mode, routine moves get just their badge. Inaccuracies get a short note, read aloud like the
      // key moments (so the opponent waits for it too).
      const inaccuracy = grade.classification === 'inaccuracy'
      const show = coached && (coachMode === 'all' || key || inaccuracy)
      const note = show
        ? message('grade', grade.message ?? '', grade, {
            prefix: found ? 'You found it! ' : undefined,
            speak: key || inaccuracy,
            context: plies.map((p) => p.uci),
          })
        : null
      update((s) => ({
        ...s,
        plies: s.plies.map((p, i) => (i === grade.ply - 1 ? { ...p, grade } : p)),
        evals: [...s.evals.slice(0, grade.ply), grade.eval_after],
        messages: note ? [...s.messages, note] : s.messages,
        retryingPly: null,
        phase: offerRetry ? 'decision' : s.phase,
        pendingRetry: offerRetry ? grade : null,
      }))
      if (note) announce(note.id)
      // Mistakes come back later as puzzles. Not while retrying: the position is saved already.
      if ((PUZZLE_GRADES.has(grade.classification) || grade.missed_mate_in !== null) && retryingPly === null) {
        api.puzzles.save(plies.map((p) => p.uci)).then((r) => r.saved && onPuzzleSavedRef.current?.(), () => {})
      }
      if (!offerRetry) continueGame()
    } catch (error) {
      if (!signal.aborted) fail(error, 'grade')
    }
  }

  /** Start a game. Only a coached game gets comments, hints, retries and take-backs. */
  const newGame = (color: Side | 'random', level: Level, assistance: Assistance = 'coached') => {
    cancelPending()
    stopSpeaking()
    replies.current.abort()
    replies.current = new AbortController()
    const userColor: Side = color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color
    saveSetting(SETTING_KEYS.assistance, assistance)
    const vs = `You're playing ${userColor} against ${level.name} (about ${level.elo})`
    const intro =
      assistance === 'unassisted'
        ? `${vs}, unassisted: no hints, take-backs, comments or evaluation. Your moves are graded quietly, and the ` +
          'game review opens when the game is over, or if you resign.'
        : assistance === 'graded'
          ? `${vs}, graded: every move, yours and your opponent's, gets its grade, and the evaluation bar shows, but ` +
            "there are no hints, take-backs or comments. The game review opens when the game is over, or if you resign."
          : `You're playing ${userColor} against ${level.name} (about ${level.elo}). ` +
      (stateRef.current.coachMode === 'key'
        ? "Every move gets a grade badge, and I'll speak up at the moments that matter. If you slip up, you can try again."
        : "I'll comment on every move, and if you slip up I'll give you the chance to try again.") +
      ' Moves are written like 11.c3, meaning White\'s 11th move, a pawn to c3. Point at one to see it on the board.'
    update((s) => ({
      ...INITIAL,
      retryMode: s.retryMode,
      coachMode: s.coachMode,
      voice: s.voice,
      assistance,
      userColor,
      level,
      phase: userColor === 'white' ? 'user' : 'bot',
      messages: [message('info', intro)],
    }))
    const signal = pending.current.signal
    api
      .analyze([], signal)
      .then((a) => {
        if (!signal.aborted) update((s) => ({ ...s, evals: [s.evals[0] ?? a.eval, ...s.evals.slice(1)] }))
      })
      .catch(() => {}) // the eval bar just stays centred
    if (userColor === 'black') void runBot()
  }

  const playMove = (uci: string) => {
    const s = stateRef.current
    if (s.phase !== 'user') return
    const game = buildGame(s.plies)
    if (game.turn() !== s.userColor[0]) return
    let san: string
    try {
      san = game.move(toMove(uci)).san
    } catch {
      return // illegal
    }
    stopSpeaking() // the student has moved on
    // A new move starts a new line, so what was taken back can't be replayed any more.
    update((s) => ({ ...s, plies: [...s.plies, { uci, san, grade: null }], hintArrow: null, pieceHint: null, redo: [] }))
    void gradeLastMove()
  }

  /** Take back the move the coach flagged. With `reveal`, also show the best move. */
  const tryAgain = (reveal: boolean) => {
    const grade = stateRef.current.pendingRetry
    if (stateRef.current.phase !== 'decision' || !grade) return
    cancelPending()
    const text = reveal ? `The best move was ${grade.best_san}. Go ahead and play it.` : retryHint(grade)
    const note = message('info', text, undefined, { speak: true, context: stateRef.current.plies.map((p) => p.uci) })
    update((s) => ({
      ...s,
      plies: s.plies.slice(0, grade.ply - 1),
      evals: s.evals.slice(0, grade.ply),
      phase: 'user',
      pendingRetry: null,
      retryingPly: reveal ? null : grade.ply,
      hintArrow:
        reveal && grade.best_move ? { from: grade.best_move.slice(0, 2), to: grade.best_move.slice(2, 4) } : null,
      messages: [...s.messages, note],
    }))
    announce(note.id)
  }

  /** Take back the user's last move (and the opponent's reply, if it has been played). */
  const undo = () => {
    const s = stateRef.current
    const userIndex = s.plies.findLastIndex((_, i) => (i % 2 === 0 ? 'w' : 'b') === s.userColor[0])
    if (userIndex < 0 || s.phase === 'setup' || s.assistance !== 'coached') return
    cancelPending()
    const label = moveLabel(userIndex, s.plies[userIndex].san)
    update((s) => ({
      ...s,
      plies: s.plies.slice(0, userIndex),
      evals: s.evals.slice(0, userIndex + 1),
      phase: 'user',
      pendingRetry: null,
      retryingPly: null,
      hintArrow: null,
      pieceHint: null,
      failed: null,
      redo: [...s.redo, { plies: s.plies.slice(userIndex), evals: s.evals.slice(userIndex + 1) }],
      messages: [...s.messages, message('info', `Took back ${label}.`, undefined, { context: s.plies.map((p) => p.uci) })],
    }))
  }

  /** Put back what the last Take back removed, grades and all. */
  const forward = () => {
    const s = stateRef.current
    const step = s.redo.at(-1)
    if (!step || s.phase === 'setup' || s.assistance !== 'coached') return
    cancelPending()
    stopSpeaking()
    const first = s.plies.length
    const label = moveLabel(first, step.plies[0].san)
    update((s) =>
      finishTurn(
        {
          ...s,
          plies: [...s.plies, ...step.plies],
          evals: [...s.evals, ...step.evals],
          redo: s.redo.slice(0, -1),
          pendingRetry: null,
          retryingPly: null,
          hintArrow: null,
          pieceHint: null,
          failed: null,
          messages: [
            ...s.messages,
            message('info', `Went forward to ${label}.`, undefined, { context: [...s.plies, ...step.plies].map((p) => p.uci) }),
          ],
        },
        'user',
      ),
    )
    // If the opponent's reply wasn't part of what was taken back, it's their move now.
    const after = stateRef.current
    if (after.phase === 'user' && buildGame(after.plies).turn() !== after.userColor[0]) void runBot()
  }

  const retryFailed = () => {
    const { failed } = stateRef.current
    if (failed === 'grade') void gradeLastMove()
    else if (failed === 'bot') void runBot()
  }

  /** Hints used at the current position. */
  const hintsHere = (s: GameState) => (s.hints.at === s.plies.length ? s.hints : { at: s.plies.length, idea: false, piece: 0 as const })
  const studentToMove = (s: GameState) => s.phase === 'user' && buildGame(s.plies).turn() === s.userColor[0]

  /** Ask for hint `level` (1: the idea, 2: the piece, 3: the move) and post it in the feed. */
  const hint = (level: 1 | 2 | 3) => {
    const s = stateRef.current
    const at = s.plies.length
    const moves = s.plies.map((p) => p.uci)
    const note = message('hint', '', undefined, { loading: true, hintLevel: level, speak: true, context: moves })
    update((s) => ({ ...s, messages: [...s.messages, note] }))
    void fill(
      note.id,
      async (signal) => {
        const result = await api.hint({ moves, student_color: s.userColor, level }, signal)
        // Only show the piece or the move on the board if the student hasn't moved on in the meantime.
        if (stateRef.current.plies.length === at) {
          const { move, square } = result
          if (move) update((s) => ({ ...s, hintArrow: { from: move.slice(0, 2), to: move.slice(2, 4) } }))
          else if (square) update((s) => ({ ...s, pieceHint: square }))
        }
        return result.text
      },
      "I couldn't come up with a hint just now.",
    )
  }

  /** 💡 Hint: point toward the idea. */
  const requestIdea = () => {
    const s = stateRef.current
    if (s.assistance !== 'coached' || !studentToMove(s) || hintsHere(s).idea) return
    update((s) => ({ ...s, hints: { ...hintsHere(s), idea: true } }))
    hint(1)
  }

  /** ♟ Show piece, then (pressed again) ➜ Show move. */
  const revealPiece = () => {
    const s = stateRef.current
    const step = hintsHere(s).piece
    if (s.assistance !== 'coached' || !studentToMove(s) || step >= 2) return
    update((s) => ({ ...s, hints: { ...hintsHere(s), piece: (step + 1) as 1 | 2 } }))
    hint(step === 0 ? 2 : 3)
  }

  /** Give up the game. */
  const resign = () => {
    const s = stateRef.current
    if (s.phase === 'setup' || s.phase === 'over') return
    cancelPending()
    stopSpeaking()
    update((s) => ({
      ...s,
      phase: 'over',
      resigned: true,
      pendingRetry: null,
      retryingPly: null,
      hintArrow: null,
      pieceHint: null,
      messages: [...s.messages, message('over', RESIGNED)],
    }))
  }

  /** Open the game review, on the game as it stands now. (Outside coached games, only once it's over.) */
  const openReview = () => {
    const s = stateRef.current
    if (s.phase === 'setup' || !s.plies.some((p) => p.grade) || (s.assistance !== 'coached' && s.phase !== 'over')) return
    stopSpeaking()
    const result = s.phase !== 'over' ? null : s.resigned ? RESIGNED : (gameOverText(buildGame(s.plies), s.userColor) ?? null)
    update((s) => ({ ...s, review: { plies: s.plies, evals: s.evals, userColor: s.userColor, result }, reviewOpen: true }))
  }

  const closeReview = () => update((s) => ({ ...s, reviewOpen: false }))

  const setRetryMode = (retryMode: RetryMode) => {
    update((s) => ({ ...s, retryMode }))
    saveSetting(SETTING_KEYS.retryMode, retryMode)
  }

  const setCoachMode = (coachMode: CoachMode) => {
    update((s) => ({ ...s, coachMode }))
    saveSetting(SETTING_KEYS.coachMode, coachMode)
  }

  const setVoice = (voice: boolean) => {
    if (!voice) stopSpeaking()
    update((s) => ({ ...s, voice }))
    saveSetting(SETTING_KEYS.voice, voice ? 'on' : 'off')
  }

  const game = useMemo(() => buildGame(state.plies), [state.plies])
  const coached = state.assistance === 'coached'
  const canUndo =
    coached && state.phase !== 'setup' && state.plies.some((_, i) => (i % 2 === 0 ? 'w' : 'b') === state.userColor[0])
  const canRedo = coached && state.phase !== 'setup' && state.redo.length > 0
  const hints = state.hints.at === state.plies.length ? state.hints : { idea: false, piece: 0 }
  const myTurn = state.phase === 'user' && game.turn() === state.userColor[0]
  const canReview = state.phase !== 'setup' && state.plies.some((p) => p.grade) && (coached || state.phase === 'over')
  // During an unassisted game, grades and the evaluation stay hidden (they'd be help).
  const gradesHidden = state.assistance === 'unassisted' && state.phase !== 'over'

  return {
    ...state,
    game,
    canUndo,
    canRedo,
    coached,
    canIdea: coached && myTurn && !hints.idea,
    /** 0: "show piece" not used yet, 1: the piece is shown (next press shows the move), 2: both shown. */
    pieceStep: hints.piece,
    canPiece: coached && myTurn && hints.piece < 2,
    gradesHidden,
    canReview,
    actions: {
      newGame, playMove, tryAgain, continueGame, undo, forward, retryFailed, requestIdea, revealPiece,
      openReview, closeReview, resign, setRetryMode, setCoachMode, setVoice,
    },
  }
}
