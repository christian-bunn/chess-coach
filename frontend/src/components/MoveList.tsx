import { useEffect, useRef } from 'react'
import { GRADE_META } from '../grades'
import type { Ply } from '../useCoachGame'

interface MoveListProps {
  plies: Ply[]
  /** false during an unassisted game, so the grades don't give anything away. */
  showGrades?: boolean
  /** The move whose position is on the board (0-based); the last move unless an earlier one is being viewed. */
  current?: number
  /** Show the position after move `index` (clicking a move). */
  onSelect?: (index: number) => void
}

export function MoveList({ plies, showGrades = true, current = plies.length - 1, onSelect }: MoveListProps) {
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [plies.length])

  const rows: [Ply, Ply | undefined][] = []
  for (let i = 0; i < plies.length; i += 2) rows.push([plies[i], plies[i + 1]])

  if (rows.length === 0) return <p className="muted move-list-empty">No moves yet.</p>
  const cell = (ply: Ply, index: number) => (
    <MoveCell ply={ply} current={index === current} showGrade={showGrades} onSelect={onSelect && (() => onSelect(index))} />
  )
  return (
    <ol className="move-list" ref={list}>
      {rows.map(([white, black], i) => (
        <li key={i}>
          <span className="move-number">{i + 1}.</span>
          {cell(white, i * 2)}
          {black ? cell(black, i * 2 + 1) : <span />}
        </li>
      ))}
    </ol>
  )
}

function MoveCell({
  ply,
  current,
  showGrade,
  onSelect,
}: {
  ply: Ply
  current: boolean
  showGrade: boolean
  onSelect?: () => void
}) {
  const meta = ply.grade && showGrade ? GRADE_META[ply.grade.classification] : null
  return (
    <button
      type="button"
      className={`move ${current ? 'current' : ''}`}
      title={meta ? `${meta.label} · show this position` : 'Show this position'}
      onClick={onSelect}
      disabled={!onSelect}
    >
      {meta && (
        <span className="badge small" style={{ background: meta.color }}>
          {meta.symbol}
        </span>
      )}
      {ply.san}
    </button>
  )
}
