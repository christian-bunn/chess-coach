import { Chess } from 'chess.js'
import { useMemo, useRef, useState } from 'react'
import { api, type CoachEvent, type Eval, type Level, type MoveGrade } from './api'
import { GOOD_GRADES } from './grades'

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

export interface Ply {
  uci: string
  san: string
  grade: MoveGrade | null
}

export interface CoachMessage {
  id: number
  /** 'question' is the student's own message; 'answer' and 'hint' come from the coach. */
  kind: 'grade' | 'opponent' | 'info' | 'over' | 'error' | 'hint' | 'question' | 'answer'
  text: string
  /** The built-in text, shown until Claude's arrives and kept if Claude fails. */
  template: string
  /** Shown before the comment, e.g. "You found it!". */
  prefix?: string
  /** True while Claude's comment is still streaming in. */
  explaining?: boolean
  /** For hints: which level (1-3). */
  hintLevel?: number
  grade?: MoveGrade
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
  hints: { at: number; used: number }
  failed: 'grade' | 'bot' | null
  retryMode: RetryMode
}

const RETRY_MODE_KEY = 'chess-coach.retry-mode'

function loadRetryMode(): RetryMode {
  try {
    const saved = localStorage.getItem(RETRY_MODE_KEY)
    if (saved === 'mistakes' || saved === 'blunders' || saved === 'off') return saved
  } catch {
    // storage unavailable: fall through to the default
  }
  return 'mistakes'
}

let nextMessageId = 1
function message(
  kind: CoachMessage['kind'],
  text: string,
  grade?: MoveGrade,
  extra?: Partial<Pick<CoachMessage, 'prefix' | 'explaining' | 'template' | 'hintLevel'>>,
): CoachMessage {
  return { id: nextMessageId++, kind, text, template: text, grade, ...extra }
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
  hints: { at: 0, used: 0 },
  failed: null,
  retryMode: 'mistakes',
}

export const HINT_LEVELS = 3
// Earlier questions and answers sent along with a new question, for context.
const ASK_HISTORY = 4

/** `coachAI`: whether the backend has Claude available to write the comments. */
export function useCoachGame(coachAI: boolean) {
  const [state, setState] = useState<GameState>(() => ({ ...INITIAL, retryMode: loadRetryMode() }))
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

  // Claude's comments stream in after each grade. Only a new game cancels them: after a take-back
  // the comment on the taken-back move is still worth reading.
  const explanations = useRef(new AbortController())
  const coachAIRef = useRef(coachAI)
  coachAIRef.current = coachAI

  const editMessage = (id: number, fn: (m: CoachMessage) => CoachMessage | null) =>
    update((s) => ({ ...s, messages: s.messages.flatMap((m) => (m.id === id ? (fn(m) ?? []) : [m])) }))

  /**
   * Stream a coach reply into message `id`, replacing its template text as it arrives. If the reply
   * fails, the template stays; a message left with no text at all is removed.
   */
  const streamInto = async (
    id: number,
    run: (onEvent: (event: CoachEvent) => void, signal: AbortSignal) => Promise<void>,
    onMove?: (uci: string) => void,
  ) => {
    const signal = explanations.current.signal
    let streamed = ''
    let finished = false
    const finish = (text?: string) => {
      finished = true
      editMessage(id, (m) => {
        const final = text || m.template
        return final ? { ...m, text: final, explaining: false } : null
      })
    }
    try {
      await run((event) => {
        if (signal.aborted) return
        if (event.type === 'text') {
          streamed += event.text
          const text = streamed
          editMessage(id, (m) => ({ ...m, text }))
        } else if (event.type === 'reset') {
          streamed = ''
          editMessage(id, (m) => ({ ...m, text: m.template }))
        } else if (event.type === 'move') {
          onMove?.(event.uci)
        } else {
          finish(event.text)
        }
      }, signal)
      if (!finished && !signal.aborted) finish() // the stream ended early: keep the template
    } catch {
      if (!signal.aborted) finish()
    }
  }

  /** Swap message `id`'s template for Claude's comment on the last move in `moves`. */
  const explainMove = (id: number, moves: string[], revealBest: boolean) =>
    streamInto(id, (onEvent, signal) =>
      api.explain({ moves, student_color: stateRef.current.userColor, reveal_best: revealBest }, onEvent, signal),
    )

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
    return { ...s, phase: 'over', messages: [...s.messages, message('over', over)] }
  }

  const runBot = async () => {
    const signal = pending.current.signal
    update((s) => ({ ...s, phase: 'bot', failed: null }))
    const { plies, level } = stateRef.current
    try {
      const grade = await api.botMove(plies.map((p) => p.uci), level?.id ?? 'casual', signal)
      if (signal.aborted) return
      // Without Claude, the opponent's moves only get a comment when there's something to punish.
      const explain = coachAIRef.current
      const note = explain || grade.message ? message('opponent', grade.message ?? '', grade, { explaining: explain }) : null
      update((s) =>
        finishTurn(
          {
            ...s,
            plies: [...s.plies, { uci: grade.uci, san: grade.san, grade }],
            evals: [...s.evals.slice(0, grade.ply), grade.eval_after],
            messages: note ? [...s.messages, note] : s.messages,
          },
          'user',
        ),
      )
      if (note && explain) void explainMove(note.id, [...plies.map((p) => p.uci), grade.uci], true)
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
      const { retryingPly, retryMode } = stateRef.current
      const found = retryingPly === grade.ply && GOOD_GRADES.has(grade.classification)
      const offerRetry = wantsRetry(grade, retryMode)
      const explain = coachAIRef.current
      const note = message('grade', grade.message ?? '', grade, {
        prefix: found ? 'You found it! ' : undefined,
        explaining: explain,
      })
      update((s) => ({
        ...s,
        plies: s.plies.map((p, i) => (i === grade.ply - 1 ? { ...p, grade } : p)),
        evals: [...s.evals.slice(0, grade.ply), grade.eval_after],
        messages: [...s.messages, note],
        retryingPly: null,
        phase: offerRetry ? 'decision' : s.phase,
        pendingRetry: offerRetry ? grade : null,
      }))
      // While a retry is on offer, Claude isn't told the best move, so it can't give the answer away.
      if (explain) void explainMove(note.id, plies.map((p) => p.uci), !offerRetry)
      if (!offerRetry) continueGame()
    } catch (error) {
      if (!signal.aborted) fail(error, 'grade')
    }
  }

  const newGame = (color: Side | 'random', level: Level) => {
    cancelPending()
    explanations.current.abort()
    explanations.current = new AbortController()
    const userColor: Side = color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : color
    const intro =
      `You're playing ${userColor} against ${level.name} (about ${level.elo}). ` +
      "I'll grade every move you make, and if you slip up I'll give you the chance to try again."
    update((s) => ({
      ...INITIAL,
      retryMode: s.retryMode,
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
    update((s) => ({ ...s, plies: [...s.plies, { uci, san, grade: null }], hintArrow: null }))
    void gradeLastMove()
  }

  /** Take back the move the coach flagged. With `reveal`, also show the best move. */
  const tryAgain = (reveal: boolean) => {
    const grade = stateRef.current.pendingRetry
    if (stateRef.current.phase !== 'decision' || !grade) return
    cancelPending()
    const text = reveal ? `The best move was ${grade.best_san}. Go ahead and play it.` : retryHint(grade)
    update((s) => ({
      ...s,
      plies: s.plies.slice(0, grade.ply - 1),
      evals: s.evals.slice(0, grade.ply),
      phase: 'user',
      pendingRetry: null,
      retryingPly: reveal ? null : grade.ply,
      hintArrow:
        reveal && grade.best_move ? { from: grade.best_move.slice(0, 2), to: grade.best_move.slice(2, 4) } : null,
      messages: [...s.messages, message('info', text)],
    }))
  }

  /** Take back the user's last move (and the opponent's reply, if it has been played). */
  const undo = () => {
    const s = stateRef.current
    const userIndex = s.plies.findLastIndex((_, i) => (i % 2 === 0 ? 'w' : 'b') === s.userColor[0])
    if (userIndex < 0 || s.phase === 'setup') return
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
      failed: null,
      messages: [...s.messages, message('info', `Took back ${label}.`)],
    }))
  }

  const retryFailed = () => {
    const { failed } = stateRef.current
    if (failed === 'grade') void gradeLastMove()
    else if (failed === 'bot') void runBot()
  }

  /** The next hint level for the current position: the idea, then the piece, then the move (with an arrow). */
  const requestHint = () => {
    const s = stateRef.current
    if (s.phase !== 'user' || buildGame(s.plies).turn() !== s.userColor[0]) return
    const at = s.plies.length
    const level = (s.hints.at === at ? s.hints.used : 0) + 1
    if (level > HINT_LEVELS) return
    const note = message('hint', '', undefined, {
      template: "I couldn't come up with a hint just now.",
      explaining: true,
      hintLevel: level,
    })
    update((s) => ({ ...s, hints: { at, used: level }, messages: [...s.messages, note] }))
    const moves = s.plies.map((p) => p.uci)
    void streamInto(
      note.id,
      (onEvent, signal) => api.hint({ moves, student_color: s.userColor, level }, onEvent, signal),
      (uci) => {
        // Only if the student hasn't moved on in the meantime.
        if (stateRef.current.plies.length === at) {
          update((s) => ({ ...s, hintArrow: { from: uci.slice(0, 2), to: uci.slice(2, 4) } }))
        }
      },
    )
  }

  /** Ask the coach a question about the current position. */
  const ask = (question: string) => {
    const s = stateRef.current
    question = question.trim()
    if (!question || s.phase === 'setup') return
    // Earlier finished exchanges, for context.
    const history: { question: string; answer: string }[] = []
    s.messages.forEach((m, i) => {
      const reply = s.messages[i + 1]
      if (m.kind === 'question' && reply?.kind === 'answer' && !reply.explaining) {
        history.push({ question: m.text, answer: reply.text })
      }
    })
    const asked = message('question', question)
    const answer = message('answer', '', undefined, {
      template: "Sorry, I couldn't answer that just now. Try asking again.",
      explaining: true,
    })
    update((s) => ({ ...s, messages: [...s.messages, asked, answer] }))
    const body = {
      moves: s.plies.map((p) => p.uci),
      student_color: s.userColor,
      question,
      history: history.slice(-ASK_HISTORY),
      reveal_best: s.phase !== 'decision',
    }
    void streamInto(answer.id, (onEvent, signal) => api.ask(body, onEvent, signal))
  }

  const setRetryMode = (retryMode: RetryMode) => {
    update((s) => ({ ...s, retryMode }))
    try {
      localStorage.setItem(RETRY_MODE_KEY, retryMode)
    } catch {
      // not persisted; fine
    }
  }

  const game = useMemo(() => buildGame(state.plies), [state.plies])
  const canUndo = state.phase !== 'setup' && state.plies.some((_, i) => (i % 2 === 0 ? 'w' : 'b') === state.userColor[0])
  const hintsUsed = state.hints.at === state.plies.length ? state.hints.used : 0
  const canHint = state.phase === 'user' && game.turn() === state.userColor[0] && hintsUsed < HINT_LEVELS

  return {
    ...state,
    game,
    canUndo,
    hintsUsed,
    canHint,
    actions: { newGame, playMove, tryAgain, continueGame, undo, retryFailed, setRetryMode, requestHint, ask },
  }
}
