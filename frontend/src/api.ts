// Types mirror backend/app/grading.py and backend/app/main.py.

export type Classification =
  | 'forced'
  | 'best'
  | 'great'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'

/** Evaluation from White's point of view. */
export interface Eval {
  cp: number | null
  /** Moves until mate: positive = White mates, negative = Black mates, 0 = checkmate on the board. */
  mate: number | null
  white_win: number
}

export interface MoveGrade {
  ply: number
  color: 'white' | 'black'
  uci: string
  san: string
  classification: Classification
  win_before: number
  win_after: number
  win_loss: number
  eval_after: Eval
  best_move: string | null
  best_san: string | null
  best_line: string[]
  refutation: string[]
  material_change: number
  best_material_change: number
  missed_mate_in: number | null
  allows_mate_in: number | null
  delivers_mate: boolean
  retry_suggested: boolean
  message: string | null
}

export interface Level {
  id: string
  name: string
  elo: number
  description: string
}

export interface Analysis {
  eval: Eval
  lines: { uci: string; san: string; eval: Eval; pv: string[] }[]
}

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const detail = await response.json().then((j) => j.detail, () => null)
    throw new Error(typeof detail === 'string' ? detail : `Server error (${response.status})`)
  }
  return response.json() as Promise<T>
}

export interface CoachConfig {
  /** Whether Claude writes the comments (otherwise the built-in templates do). */
  coach_ai: boolean
  model: string | null
  /** "claude-code": through Claude Code on the user's Claude plan. "api": an API key, billed per request. */
  via: 'claude-code' | 'api' | null
  /** Whether the backend can read comments aloud (a Piper voice is installed). */
  voice: boolean
}

/** One line of a streamed coach reply (comment, hint or answer). */
export type CoachEvent =
  | { type: 'text'; text: string }
  /** Discard what has streamed so far (a fallback model took over, or Claude failed). */
  | { type: 'reset' }
  /** The suggested move, sent first by the last hint level so the board can show it. */
  | { type: 'move'; uci: string }
  | { type: 'done'; text: string; source: 'claude' | 'template' }

interface PositionRequest {
  moves: string[]
  student_color: 'white' | 'black'
}

export interface ExplainRequest extends PositionRequest {
  /** False while a retry is on offer, so the comment can't give the answer away. */
  reveal_best: boolean
}

export interface HintRequest extends PositionRequest {
  /** 1: the idea, 2: the piece, 3: the move. */
  level: number
}

export interface AskRequest extends PositionRequest {
  question: string
  /** Earlier questions and answers, oldest first, for context. */
  history: { question: string; answer: string }[]
  reveal_best: boolean
}

// Give up on a reply that takes longer than this; the caller keeps its fallback text.
const STREAM_TIMEOUT_MS = 45_000

/** POST `body` to `path` and pass each streamed event to `onEvent`; the server sends one JSON event per line. */
async function streamCoach(path: string, body: unknown, onEvent: (event: CoachEvent) => void, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(STREAM_TIMEOUT_MS)
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!response.ok || !response.body) throw new Error(`Server error (${response.status})`)
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffered = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffered += value
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as CoachEvent)
  }
}

type OnEvent = (event: CoachEvent) => void

export const api = {
  config: () => request<CoachConfig>('/config'),
  levels: () => request<Level[]>('/levels'),
  /** The coach's comment on the last move in `moves`. */
  explain: (body: ExplainRequest, onEvent: OnEvent, signal?: AbortSignal) => streamCoach('/explain', body, onEvent, signal),
  hint: (body: HintRequest, onEvent: OnEvent, signal?: AbortSignal) => streamCoach('/hint', body, onEvent, signal),
  ask: (body: AskRequest, onEvent: OnEvent, signal?: AbortSignal) => streamCoach('/ask', body, onEvent, signal),
  analyze: (moves: string[], signal?: AbortSignal) => request<Analysis>('/analyze', { moves }, signal),
  grade: (moves: string[], signal?: AbortSignal) => request<MoveGrade>('/grade', { moves }, signal),
  botMove: (moves: string[], level: string, signal?: AbortSignal) =>
    request<MoveGrade>('/bot-move', { moves, level }, signal),
}
