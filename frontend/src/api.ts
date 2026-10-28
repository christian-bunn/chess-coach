// Types mirror backend/app/grading.py and backend/app/main.py.

import { currentPlayer } from './player'

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
  // The player's name picks their progress on the server; encoded, since headers can't carry every letter.
  const player = currentPlayer()
  const response = await fetch(`/api${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(player ? { 'X-Player': encodeURIComponent(player) } : {}),
    },
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

/** A named line from Lichess's openings list. */
export interface OpeningLine {
  name: string
  eco: string
  /** From the start, UCI. */
  moves: string[]
  /** "1. e4 c5" */
  pgn: string
}

/** A book move from a position, with the named line it's part of and how many lines go through it. */
export interface BookMove {
  uci: string
  san: string
  name: string
  eco: string
  lines: number
  /** Whether the position it reaches is itself a named one. */
  named: boolean
}

export interface OpeningPosition {
  /** The opening reached so far (the last named position along the moves). */
  opening: { name: string; eco: string } | null
  /** Whether this position is itself a named one. */
  named: boolean
  moves: BookMove[]
}

export interface PracticeStep {
  /** False once the moves have left the opening's lines. */
  on_line: boolean
  /** The book moves that carry on within the opening, most lines first; none means the line is complete. */
  moves: { uci: string; san: string; lines: number }[]
}

/** An opening in the student's repertoire, with its review schedule (see backend/app/repertoire.py). */
export interface RepertoireEntry {
  id: string
  name: string
  eco: string
  moves: string[]
  side: 'white' | 'black'
  added: string
  due: string
  /** Reviews in a row without a mistake. */
  streak: number
  reviews: number
  lapses: number
  last_mistakes: number | null
}

/** In a game against a friend: "graded" shows both players the grades and the evaluation as they play;
 * "unassisted" shows nothing until the game is over. */
export type FriendHelp = 'graded' | 'unassisted'

export interface FriendChallenge {
  id: string
  name: string
  /** The colour the challenger plays. */
  color: 'white' | 'black' | 'random'
  time_control: string
  help: FriendHelp
}

export interface FriendLobby {
  /** Challenges other players have posted. */
  challenges: FriendChallenge[]
  /** Your game in progress, or your challenge waiting for someone. */
  game: string | null
}

/** A game against a friend, as you see it (mirrors backend/app/friends.py FriendGames.view). */
export interface FriendGameView {
  id: string
  status: 'waiting' | 'playing' | 'over'
  you: 'white' | 'black' | null
  host: boolean
  names: { white: string | null; black: string | null }
  host_name: string
  host_color: 'white' | 'black' | 'random'
  time_control: string
  help: FriendHelp
  moves: string[]
  sans: string[]
  /** Hidden (null) in an unassisted game until it's over; a move's grade is null until it's been graded. */
  grades: (MoveGrade | null)[] | null
  evals: (Eval | null)[] | null
  /** Time left (ms) as of the reply; `running` is the side whose clock is going. */
  clock: { white: number; black: number; increment: number; running: 'white' | 'black' | null } | null
  result: { reason: string; winner: 'white' | 'black' | null } | null
  draw_offer: 'white' | 'black' | null
  /** Who has asked to take their last move back, and is waiting on the other player. */
  takeback_offer: 'white' | 'black' | null
  version: number
}

export interface Repertoire {
  entries: RepertoireEntry[]
  total: number
  due: number
  mastered: number
}

export const api = {
  config: () => request<CoachConfig>('/config'),
  levels: () => request<Level[]>('/levels'),
  hint: (body: HintRequest, signal?: AbortSignal) => request<HintResult>('/hint', body, signal),
  analyze: (moves: string[], signal?: AbortSignal) => request<Analysis>('/analyze', { moves }, signal),
  grade: (moves: string[], signal?: AbortSignal) => request<MoveGrade>('/grade', { moves }, signal),
  botMove: (moves: string[], level: string, signal?: AbortSignal) =>
    request<MoveGrade>('/bot-move', { moves, level }, signal),
  openings: {
    featured: () => request<{ group: string; side: 'white' | 'black'; lines: OpeningLine[] }[]>('/openings/featured'),
    search: (q: string, signal?: AbortSignal) =>
      request<OpeningLine[]>(`/openings/search?q=${encodeURIComponent(q)}`, undefined, signal),
    explore: (moves: string[], signal?: AbortSignal) => request<OpeningPosition>('/openings/explore', { moves }, signal),
    practice: (target: string[], moves: string[], signal?: AbortSignal) =>
      request<PracticeStep>('/openings/practice', { target, moves }, signal),
  },
  repertoire: {
    list: () => request<Repertoire>('/repertoire'),
    add: (body: Pick<RepertoireEntry, 'name' | 'eco' | 'moves' | 'side'>) => request<RepertoireEntry>('/repertoire', body),
    /** Record a completed practice run; it only counts as a review if the opening was due. */
    review: (id: string, mistakes: number) =>
      request<{ entry: RepertoireEntry; counted: boolean }>(`/repertoire/${id}/review`, { mistakes }),
    remove: (id: string) => request<{ removed: boolean }>(`/repertoire/${id}`, undefined, undefined, 'DELETE'),
  },
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
  friends: {
    lobby: () => request<FriendLobby>('/friends'),
    challenge: (body: { color: 'white' | 'black' | 'random'; time_control: string; help: FriendHelp }) =>
      request<FriendGameView>('/friends/challenges', body),
    cancel: (id: string) => request<{ cancelled: boolean }>(`/friends/games/${id}`, undefined, undefined, 'DELETE'),
    join: (id: string) => request<FriendGameView>(`/friends/games/${id}/join`, {}),
    /** The game once it has changed since `after` (its version), or after a while: a long poll. */
    follow: (id: string, after: number, signal?: AbortSignal) =>
      request<FriendGameView>(`/friends/games/${id}?after=${after}`, undefined, signal),
    move: (id: string, uci: string) => request<FriendGameView>(`/friends/games/${id}/move`, { uci }),
    resign: (id: string) => request<FriendGameView>(`/friends/games/${id}/resign`, {}),
    draw: (id: string, action: 'offer' | 'accept' | 'decline') =>
      request<FriendGameView>(`/friends/games/${id}/draw`, { action }),
    /** Ask to take your last move back, or answer your opponent's request. */
    takeback: (id: string, action: 'offer' | 'accept' | 'decline') =>
      request<FriendGameView>(`/friends/games/${id}/takeback`, { action }),
  },
}
