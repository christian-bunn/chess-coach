import type { Chess, Square } from 'chess.js'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Chessboard, defaultPieces, type Arrow } from 'react-chessboard'
import type { Classification } from '../api'
import { GRADE_META } from '../grades'
import { playMove } from '../sounds'

interface BoardProps {
  game: Chess
  orientation: 'white' | 'black'
  /** True when the user may move (their turn, nothing pending). */
  interactive: boolean
  userColor: 'w' | 'b'
  lastMove: { from: string; to: string } | null
  badge: { square: string; classification: Classification } | null
  arrows: Arrow[]
  onMove: (uci: string) => void
  /** Shown over the top of the board, e.g. what a previewed move is. */
  caption?: string
  /** Animate pieces to their new squares (off for instant previews). */
  animate?: boolean
  /** A square to draw attention to, e.g. the piece a hint points at. */
  highlight?: string | null
}

const LAST_MOVE = 'rgba(255, 255, 51, 0.42)'
const SELECTED = 'rgba(20, 85, 180, 0.45)'
const MOVE_DOT = 'radial-gradient(circle, rgba(0, 0, 0, 0.18) 21%, transparent 23%)'
const CAPTURE_RING = 'radial-gradient(circle, transparent 57%, rgba(0, 0, 0, 0.18) 59%)'
const CHECK = 'radial-gradient(circle, rgba(255, 0, 0, 0.85) 0%, rgba(231, 0, 0, 0.5) 30%, transparent 75%)'

export function Board({
  game,
  orientation,
  interactive,
  userColor,
  lastMove,
  badge,
  arrows,
  onMove,
  caption,
  animate = true,
  highlight = null,
}: BoardProps) {
  const [selected, setSelected] = useState<Square | null>(null)
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null)
  const fen = game.fen()

  useEffect(() => {
    setSelected(null)
    setPromotion(null)
  }, [fen, interactive])

  // A move makes its sound here, the one place every mode's board comes through. Previews and stepping back
  // through a game arrive with the animation off and stay silent. `sounded` is what holds a move that lands
  // while a preview is still up (animation off for that render, on for the next) to a single sound.
  const shown = useRef<{ before: string | null; fen: string | null; sounded: boolean }>({
    before: null,
    fen: null,
    sounded: false,
  })
  useEffect(() => {
    const state = shown.current
    if (state.fen !== fen) {
      state.before = state.fen
      state.fen = fen
      state.sounded = false
    }
    if (state.sounded || !state.before || !lastMove || !animate) return
    state.sounded = true
    playMove(state.before, game, lastMove.from, lastMove.to)
  }, [fen, animate])

  const legalFrom = (square: Square) => game.moves({ square, verbose: true })

  /** Make the move if legal; pawn moves to the last rank open the promotion picker first. */
  const tryMove = (from: Square, to: Square): 'moved' | 'promotion' | 'illegal' => {
    const candidates = legalFrom(from).filter((m) => m.to === to)
    if (candidates.length === 0) return 'illegal'
    if (candidates.some((m) => m.promotion)) {
      setPromotion({ from, to })
      return 'promotion'
    }
    onMove(from + to)
    return 'moved'
  }

  const ownsPiece = (pieceType: string | undefined) => interactive && pieceType?.[0] === userColor

  const squareStyles: Record<string, CSSProperties> = {}
  const style = (square: string, extra: CSSProperties) => {
    squareStyles[square] = { ...squareStyles[square], ...extra }
  }
  if (lastMove) {
    style(lastMove.from, { backgroundColor: LAST_MOVE })
    style(lastMove.to, { backgroundColor: LAST_MOVE })
  }
  if (highlight) style(highlight, { boxShadow: 'inset 0 0 0 5px #f0c03a', backgroundColor: 'rgba(240, 192, 58, 0.45)' })
  if (game.inCheck()) {
    const king = game.findPiece({ type: 'k', color: game.turn() })[0]
    if (king) style(king, { backgroundImage: CHECK })
  }
  // The badge hangs over its square's top-right corner, except where the board's edge would cut it off.
  const badgeClass = (square: string) => {
    const [file, rank] = [square[0], square[1]]
    const top = rank === (orientation === 'white' ? '8' : '1')
    const right = file === (orientation === 'white' ? 'h' : 'a')
    return `square-badge${top ? ' edge-top' : ''}${right ? ' edge-right' : ''}`
  }
  if (selected) {
    style(selected, { backgroundColor: SELECTED })
    for (const move of legalFrom(selected)) {
      style(move.to, { backgroundImage: move.isCapture() ? CAPTURE_RING : MOVE_DOT })
    }
  }

  return (
    <div className="board">
      <Chessboard
        options={{
          id: 'coach-board',
          position: fen,
          boardOrientation: orientation,
          showAnimations: animate,
          allowDragging: interactive,
          arrows,
          darkSquareStyle: { backgroundColor: '#769656' },
          // Coordinates scale with the board instead of staying at a fixed tiny size.
          alphaNotationStyle: { fontSize: 'calc(var(--board-size) / 8 * 0.17)', fontWeight: 600 },
          numericNotationStyle: { fontSize: 'calc(var(--board-size) / 8 * 0.17)', fontWeight: 600 },
          lightSquareStyle: { backgroundColor: '#eeeed2' },
          canDragPiece: ({ piece }) => ownsPiece(piece.pieceType),
          onPieceDrag: ({ square }) => setSelected(square as Square | null),
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            setSelected(null)
            if (!interactive || !targetSquare) return false
            return tryMove(sourceSquare as Square, targetSquare as Square) === 'moved'
          },
          onSquareClick: ({ piece, square }) => {
            if (!interactive) return
            if (selected && tryMove(selected, square as Square) !== 'illegal') {
              setSelected(null)
            } else if (ownsPiece(piece?.pieceType) && square !== selected) {
              setSelected(square as Square)
            } else {
              setSelected(null)
            }
          },
          squareRenderer: ({ square, children }) => (
            <div style={{ width: '100%', height: '100%', position: 'relative', ...squareStyles[square] }}>
              {children}
              {badge?.square === square && (
                <span
                  className={badgeClass(square)}
                  style={{ background: GRADE_META[badge.classification].color }}
                  title={GRADE_META[badge.classification].label}
                >
                  {GRADE_META[badge.classification].symbol}
                </span>
              )}
            </div>
          ),
        }}
      />
      {caption && <div className="board-caption">{caption}</div>}
      {promotion && (
        <div className="promotion" role="dialog" aria-label="Choose a piece to promote to">
          <div className="promotion-choices">
            {(['q', 'r', 'b', 'n'] as const).map((piece) => {
              const code = `${userColor}${piece.toUpperCase()}`
              return (
                <button
                  key={piece}
                  onClick={() => {
                    onMove(promotion.from + promotion.to + piece)
                    setPromotion(null)
                  }}
                >
                  {defaultPieces[code]()}
                </button>
              )
            })}
          </div>
          <button className="link" onClick={() => setPromotion(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
