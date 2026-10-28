import type { PieceSymbol } from 'chess.js'
import { defaultPieces } from 'react-chessboard'

interface CapturesProps {
  /** The pieces this side has taken (so they're the other colour), biggest first. */
  pieces: PieceSymbol[]
  /** The side that took them. */
  by: 'white' | 'black'
  /** The material edge in pawns from White's side; it's shown next to whoever is ahead. */
  edge: number
}

/** What one side has taken, in a row beside the board. Empty (but still there) until they take something. */
export function Captures({ pieces, by, edge }: CapturesProps) {
  const theirs = by === 'white' ? 'b' : 'w'
  const ahead = by === 'white' ? edge : -edge
  return (
    <div className="captures" aria-label={`Pieces ${by} has taken`}>
      {pieces.map((piece, i) => (
        <span className="taken-piece" key={i}>
          {defaultPieces[`${theirs}${piece.toUpperCase()}`]()}
        </span>
      ))}
      {ahead > 0 && <span className="material-edge">+{ahead}</span>}
    </div>
  )
}
