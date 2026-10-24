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

async function request<T>(path: string, body?: unknown, signal?: AbortSignal, method?: string): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
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

/** A position from one of the student's games where they went wrong (see backend/app/puzzles.py). */
export interface Puzzle {
  id: string
  /** The game up to the puzzle position (UCI); the student is to move. */
  moves: string[]
  color: 'white' | 'black'
  /** What the student played there in the game. */
  played: string
  played_san: string
  best: string
  best_san: string
  grade: Classification
  /** The coach's comment on the game move. */
  comment: string | null
  opening: string | null
  created: string
  due: string
  /** Solved at the first try this many times in a row. */
  streak: number
  reviews: number
  lapses: number
}

export interface PuzzleSummary {
  total: number
  due: number
  mastered: number
  /** When the next puzzle is due, if none is due now. */
  next_due: string | null
}

/** A saved game as listed (see backend/app/games.py). */
export interface SavedGameSummary {
  id: string
  saved: string
  moves: number
  color: 'white' | 'black'
  /** How it ended, or null if it was saved before the end. */
  result: string | null
  /** e.g. "Casual (~1400)" */
  opponent: string | null
  assistance: string | null
  opening: string | null
  accuracy: number | null
  opponent_accuracy: number | null
}

export type SaveGameRequest = Omit<SavedGameSummary, 'id' | 'saved' | 'moves'> & { snapshot: unknown }

export const api = {
  config: () => request<CoachConfig>('/config'),
  levels: () => request<Level[]>('/levels'),
  hint: (body: HintRequest, signal?: AbortSignal) => request<HintResult>('/hint', body, signal),
  analyze: (moves: string[], signal?: AbortSignal) => request<Analysis>('/analyze', { moves }, signal),
  grade: (moves: string[], signal?: AbortSignal) => request<MoveGrade>('/grade', { moves }, signal),
  botMove: (moves: string[], level: string, signal?: AbortSignal) =>
    request<MoveGrade>('/bot-move', { moves, level }, signal),
  games: {
    list: () => request<SavedGameSummary[]>('/games'),
    /** A saved game in full: its summary plus the review snapshot the page saved. */
    get: <Snapshot>(id: string) => request<SavedGameSummary & { snapshot: Snapshot }>(`/games/${id}`),
    save: (body: SaveGameRequest) => request<{ id: string }>('/games', body),
    remove: (id: string) => request<{ removed: boolean }>(`/games/${id}`, undefined, undefined, 'DELETE'),
  },
  puzzles: {
    summary: () => request<PuzzleSummary>('/puzzles'),
    next: (early: boolean) => request<Puzzle | null>(`/puzzles/next${early ? '?early=true' : ''}`),
    /** Every puzzle, the soonest due first. */
    all: () => request<Puzzle[]>('/puzzles/all'),
    get: (id: string) => request<Puzzle>(`/puzzles/${id}`),
    /** Save the last move in `moves` as a puzzle, if it was a mistake (the backend checks). */
    save: (moves: string[]) => request<{ saved: boolean; id: string | null }>('/puzzles', { moves }),
    attempt: (id: string, uci: string, signal?: AbortSignal) =>
      request<{ grade: MoveGrade; correct: boolean }>(`/puzzles/${id}/attempt`, { uci }, signal),
    result: (id: string, solved: boolean) => request<Puzzle>(`/puzzles/${id}/result`, { solved }),
    remove: (id: string) => request<{ removed: boolean }>(`/puzzles/${id}`, undefined, undefined, 'DELETE'),
  },
}
