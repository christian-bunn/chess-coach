import { Chess, type Move } from 'chess.js'

/** A position shown on the board instead of the game: a move about to be played. */
export interface BoardPreview {
  /** The position just before the move. */
  fen: string
  from: string
  to: string
  /** Shown over the board, e.g. "White's move 11: pawn from c2 to c3". */
  label: string
  /** The engine's better move, drawn as a second arrow. */
  best?: { from: string; to: string }
}

/** A move mentioned in a coach message ("11.c3"), resolved to the position it was played from. */
export interface MoveRef extends BoardPreview {
  text: string
}

export type Segment = string | MoveRef

// A numbered move: "11.c3", "12...Nxe4+", "5. O-O", "20... exd5".
const NUMBERED_MOVE = /\b(\d+)\.(\.\.)?\s?(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)([+#])?/g

const PIECES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }

function describe(move: Move, number: string): string {
  const side = move.color === 'w' ? 'White' : 'Black'
  let what: string
  if (move.isKingsideCastle()) what = 'castling kingside'
  else if (move.isQueensideCastle()) what = 'castling queenside'
  else {
    what = `${PIECES[move.piece]} from ${move.from} to ${move.to}`
    if (move.captured) what += `, taking a ${PIECES[move.captured]}`
    if (move.promotion) what += `, becoming a ${PIECES[move.promotion]}`
  }
  if (move.san.endsWith('#')) what += ', checkmate'
  else if (move.san.endsWith('+')) what += ', check'
  return `${side}'s move ${number}: ${what}`
}

function positionAt(context: string[], ply: number): Chess | null {
  if (ply > context.length) return null
  const game = new Chess()
  for (const uci of context.slice(0, ply)) game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  return game
}

/**
 * Split `text` into plain text and the moves it mentions. `context` is the game (UCI moves) as it stood
 * when the message was written. A move continuing a line ("12...Nxe4 13.Qe2") is played from the
 * position after the one before it; other moves from the game's position at that move number.
 * Anything that doesn't resolve to a legal move stays plain text.
 */
export function findMoveRefs(text: string, context: string[]): Segment[] {
  const segments: Segment[] = []
  let last = 0
  let line: { fen: string; ply: number; end: number } | null = null
  for (const match of text.matchAll(NUMBERED_MOVE)) {
    const [whole, number, dots, san, check] = match
    const start = match.index ?? 0
    const ply = (Number(number) - 1) * 2 + (dots ? 1 : 0)
    const continuesLine: boolean = line !== null && line.ply === ply && /^[\s,]*$/.test(text.slice(line.end, start))
    const game: Chess | null = continuesLine && line ? new Chess(line.fen) : positionAt(context, ply)
    let move: Move | null = null
    const fen = game?.fen() ?? ''
    try {
      move = game ? game.move(san + (check ?? '')) : null
    } catch {
      move = null
    }
    if (!game || !move) {
      line = null
      continue
    }
    if (start > last) segments.push(text.slice(last, start))
    segments.push({ text: whole, fen, from: move.from, to: move.to, label: describe(move, number) })
    last = start + whole.length
    line = { fen: game.fen(), ply: ply + 1, end: last }
  }
  if (last < text.length) segments.push(text.slice(last))
  return segments
}
