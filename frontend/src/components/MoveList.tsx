import { useEffect, useRef } from 'react'
import { GRADE_META } from '../grades'
import type { Ply } from '../useCoachGame'

export function MoveList({ plies }: { plies: Ply[] }) {
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
          <MoveCell ply={white} current={i * 2 === plies.length - 1} />
          {black ? <MoveCell ply={black} current={i * 2 + 1 === plies.length - 1} /> : <span />}
        </li>
      ))}
    </ol>
  )
}

function MoveCell({ ply, current }: { ply: Ply; current: boolean }) {
  const meta = ply.grade ? GRADE_META[ply.grade.classification] : null
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
