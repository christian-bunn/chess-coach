import { useEffect, useRef } from 'react'
import { GRADE_META } from '../grades'
import type { Ply } from '../useCoachGame'

/** `showGrades`: false during an unassisted game, so the grades don't give anything away. */
export function MoveList({ plies, showGrades = true }: { plies: Ply[]; showGrades?: boolean }) {
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [plies.length])

  const rows: [Ply, Ply | undefined][] = []
  for (let i = 0; i < plies.length; i += 2) rows.push([plies[i], plies[i + 1]])

  if (rows.length === 0) return <p className="muted move-list-empty">No moves yet.</p>
  return (
    <ol className="move-list" ref={list}>
      {rows.map(([white, black], i) => (
        <li key={i}>
          <span className="move-number">{i + 1}.</span>
          <MoveCell ply={white} current={i * 2 === plies.length - 1} showGrade={showGrades} />
          {black ? <MoveCell ply={black} current={i * 2 + 1 === plies.length - 1} showGrade={showGrades} /> : <span />}
        </li>
      ))}
    </ol>
  )
}

function MoveCell({ ply, current, showGrade }: { ply: Ply; current: boolean; showGrade: boolean }) {
  const meta = ply.grade && showGrade ? GRADE_META[ply.grade.classification] : null
  return (
    <span className={`move ${current ? 'current' : ''}`} title={meta?.label}>
      {meta && (
        <span className="badge small" style={{ background: meta.color }}>
          {meta.symbol}
        </span>
      )}
      {ply.san}
    </span>
  )
}
