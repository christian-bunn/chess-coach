import type { Chess, Color, PieceSymbol } from 'chess.js'

/** What a piece is worth in pawns, for the material edge. */
const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
/** How many of each a side starts with. */
const START: Record<PieceSymbol, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 }
/** The kinds that can be taken, biggest first: the order they're shown in. */
const KINDS: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p']

export interface Captures {
  /** The black pieces White has taken, biggest first. */
  byWhite: PieceSymbol[]
  /** The white pieces Black has taken. */
  byBlack: PieceSymbol[]
  /** The material edge in pawns, from White's side: 3 means White is a knight up. */
  edge: number
}

/**
 * What each side has taken, worked out from the pieces on the board: whatever is missing from a full set was
 * captured. It follows the position shown rather than the moves, so it's right for a puzzle that starts in the
 * middle of a game, and for an earlier position being looked back at. A pawn that promoted counts as the piece it
 * became, so promoting doesn't look like losing a pawn.
 */
export function captures(game: Chess): Captures {
  const counts: Record<Color, Partial<Record<PieceSymbol, number>>> = { w: {}, b: {} }
  for (const row of game.board()) {
    for (const piece of row) {
      if (piece) counts[piece.color][piece.type] = (counts[piece.color][piece.type] ?? 0) + 1
    }
  }
  const lost = (color: Color): PieceSymbol[] => {
    const on = counts[color]
    const promoted = KINDS.reduce((n, kind) => n + Math.max(0, (on[kind] ?? 0) - START[kind]), 0)
    return KINDS.flatMap((kind) => {
      const gone = Math.max(0, START[kind] - (on[kind] ?? 0) - (kind === 'p' ? promoted : 0))
      return Array<PieceSymbol>(gone).fill(kind)
    })
  }
  const byWhite = lost('b')
  const byBlack = lost('w')
  const worth = (pieces: PieceSymbol[]) => pieces.reduce((n, piece) => n + VALUE[piece], 0)
  return { byWhite, byBlack, edge: worth(byWhite) - worth(byBlack) }
}
