// Types mirror backend/app/grading.py and backend/app/main.py.

export type Classification =
  | 'forced'
  /** Opening theory (from Lichess's openings list) that the engine also likes. */
  | 'book'
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
  /** The coach's comment (on the student's moves). */
  message: string | null
  /** For the opponent's moves: what the student should focus on next, and whether it's urgent. */
  guide_topic?: string | null
  guide_urgent?: boolean
  /** The opening the game has reached by this move, e.g. "Italian Game" and "C50". */
  opening: string | null
  eco: string | null
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
  /** Whether the backend can read comments aloud (a Piper voice is installed). */
  voice: boolean
}

export interface VoiceOption {
  name: string
  label: string
}

interface PositionRequest {
  moves: string[]
  student_color: 'white' | 'black'
}

export interface HintRequest extends PositionRequest {
  /** 1: the idea, 2: the piece, 3: the move. */
  level: number
}

export interface HintResult {
  text: string
  /** The piece to move (from level 2), highlighted on the board. */
  square: string | null
  /** The move itself (level 3, UCI), shown as an arrow. */
  move: string | null
}

export interface GuideResult {
  text: string
  /** What the guidance is about ("threat", "castle", ...), so the coach doesn't repeat itself. */
  topic: string
  urgent: boolean
}

export const api = {
  config: () => request<CoachConfig>('/config'),
  levels: () => request<Level[]>('/levels'),
  voices: () => request<{ voices: VoiceOption[]; default: string | null }>('/voices'),
  hint: (body: HintRequest, signal?: AbortSignal) => request<HintResult>('/hint', body, signal),
  /** The coach's guidance before the student's move. */
  guide: (body: PositionRequest, signal?: AbortSignal) => request<GuideResult>('/guide', body, signal),
  analyze: (moves: string[], signal?: AbortSignal) => request<Analysis>('/analyze', { moves }, signal),
  grade: (moves: string[], signal?: AbortSignal) => request<MoveGrade>('/grade', { moves }, signal),
  botMove: (moves: string[], level: string, signal?: AbortSignal) =>
    request<MoveGrade>('/bot-move', { moves, level }, signal),
}
