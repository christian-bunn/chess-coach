import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { GRADE_META } from '../grades'
import type { MoveRef } from '../moveRefs'
import {
  REVIEW_GRADES, accuracy, countGrades, hadBetter, keyMoments, notBest, openingOf, sideGrades, winningChances, withoutAnswer,
} from '../review'
import { moveLabel, type ReviewSnapshot } from '../useCoachGame'
import type { Practice } from '../useReviewPractice'
import { MoveRefText } from './MoveRefText'

interface GameReviewProps {
  review: ReviewSnapshot
  /** The move shown on the board (1 = White's first), or null for none. */
  selected: number | null
  /** Show move `ply` on the board; `withBest` also draws the engine's best move. */
  onSelect: (ply: number | null, withBest?: boolean) => void
  /** The board is showing the selected move with the engine's best move. */
  withBest?: boolean
  practice: Practice | null
  onPractice: (ply: number) => void
  onTryAgain: () => void
  onShowBest: () => void
  onStopPractice: () => void
  /** Show a move mentioned in a comment on the board (null: back to what it showed). */
  onPreview: (move: MoveRef | null) => void
  onClose: () => void
  /** The close button's text ("← Back to the game", "← Saved games"). */
  closeLabel?: string
  /** A line under the title, e.g. who the game was against and when. */
  subtitle?: string
  /** Extra buttons for the top of the review: saving the game, or deleting a saved one. */
  actions?: ReactNode
}

export function GameReview({
  review,
  selected,
  onSelect,
  withBest = false,
  practice,
  onPractice,
  onTryAgain,
  onShowBest,
  onStopPractice,
  onPreview,
  onClose,
  closeLabel = '← Back to the game',
  subtitle,
  actions,
}: GameReviewProps) {
  // The move the review is on, for stepping: the one selected, or the last.
  const plyCount = review.plies.length
  const at = selected ?? plyCount
  const summary = useMemo(() => {
    const mine = sideGrades(review, true)
    const theirs = sideGrades(review, false)
    return {
      you: { accuracy: accuracy(mine), counts: countGrades(mine) },
      opponent: { accuracy: accuracy(theirs), counts: countGrades(theirs) },
      // Each with the game up to and including the move, which its comment's moves are read against.
      moments: keyMoments(review).map((grade) => ({ grade, context: review.plies.slice(0, grade.ply).map((p) => p.uci) })),
    }
  }, [review])
  const opening = useMemo(() => openingOf(review.plies), [review])

  return (
    <section className="review" aria-label="Game review">
      <div className="review-head">
        <h2>Game review</h2>
        <button onClick={onClose}>{closeLabel}</button>
      </div>
      {(subtitle || actions) && (
        <div className="review-subhead">
          {subtitle && <span className="muted">{subtitle}</span>}
          {actions && <div className="review-actions">{actions}</div>}
        </div>
      )}
      <div className="review-body">
        {review.result && <p className="review-result">{review.result}</p>}
        {opening && (
          <p className="review-opening">
            📖 {opening.name}
            {opening.eco && <span className="muted"> · {opening.eco}</span>}
          </p>
        )}
        <table className="review-table">
          <thead>
            <tr>
              <th />
              <th>You</th>
              <th>Opponent</th>
            </tr>
          </thead>
          <tbody>
            <tr className="review-accuracy">
              <th>Accuracy</th>
              <td>{formatAccuracy(summary.you.accuracy)}</td>
              <td>{formatAccuracy(summary.opponent.accuracy)}</td>
            </tr>
            {REVIEW_GRADES.map((c) => (
              <tr key={c}>
                <th>
                  <span className="badge small" style={{ background: GRADE_META[c].color }}>
                    {GRADE_META[c].symbol}
                  </span>
                  {GRADE_META[c].label}
                </th>
                <td style={{ color: summary.you.counts[c] ? GRADE_META[c].color : undefined }}>{summary.you.counts[c]}</td>
                <td>{summary.opponent.counts[c]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <EvalGraph review={review} selected={selected} onSelect={onSelect} />
        <div className="move-nav" aria-label="Step through the game">
          <button onClick={() => onSelect(1)} disabled={plyCount === 0 || at === 1} title="First move">
            ⏮
          </button>
          <button onClick={() => onSelect(Math.max(1, at - 1))} disabled={at <= 1} title="Previous move (←)">
            ◀
          </button>
          <button onClick={() => onSelect(Math.min(plyCount, at + 1))} disabled={at >= plyCount} title="Next move (→)">
            ▶
          </button>
          <button onClick={() => onSelect(plyCount)} disabled={plyCount === 0 || selected === plyCount} title="Last move">
            ⏭
          </button>
        </div>
        {selected !== null && !practice && (
          <SelectedMove review={review} ply={selected} withBest={withBest} onSelect={onSelect} />
        )}

        <h3>Key moments</h3>
        {summary.moments.length === 0 ? (
          <p className="muted">No mistakes worth going back to. Well played!</p>
        ) : (
          <ol className="moments">
            {summary.moments.map(({ grade: g, context }) => {
              const meta = GRADE_META[g.classification]
              const better = hadBetter(g)
              const practising = practice?.ply === g.ply
              return (
                <li key={g.ply} className={`moment ${selected === g.ply || practising ? 'selected' : ''}`}>
                  <button type="button" className="moment-head" onClick={() => onSelect(g.ply)} title="Show on the board">
                    <span className="badge small" style={{ background: meta.color }}>
                      {meta.symbol}
                    </span>
                    <strong>{moveLabel(g.ply - 1, g.san)}</strong>
                    <span style={{ color: meta.color }}>{meta.label}</span>
                  </button>
                  {g.message && (
                    <p>
                      <MoveRefText text={g.message} context={context} onPreview={onPreview} />
                    </p>
                  )}
                  {practising ? (
                    <PracticeBox
                      practice={practice}
                      bestSan={g.best_san}
                      context={context}
                      onPreview={onPreview}
                      onTryAgain={onTryAgain}
                      onShowBest={onShowBest}
                      onStop={onStopPractice}
                    />
                  ) : (
                    better && (
                      <div className="moment-actions">
                        <button className="primary" onClick={() => onPractice(g.ply)}>
                          ↻ Retry
                        </button>
                        <button onClick={() => onSelect(g.ply, true)}>Show best move</button>
                      </div>
                    )
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}

/** The move on the board: whose it was, its grade, and the engine's best move when it would have played another
 * (which can be drawn on the board), for every move of the game, not just the key moments. */
function SelectedMove({
  review,
  ply,
  withBest,
  onSelect,
}: {
  review: ReviewSnapshot
  ply: number
  withBest: boolean
  onSelect: GameReviewProps['onSelect']
}) {
  const played = review.plies[ply - 1]
  const grade = played?.grade
  if (!grade) return null
  const meta = GRADE_META[grade.classification]
  const other = notBest(grade)
  return (
    <div className="review-move">
      <span className="muted">{grade.color === review.userColor ? 'You' : 'Opponent'}</span>
      <span className="badge small" style={{ background: meta.color }}>
        {meta.symbol}
      </span>
      <strong>{moveLabel(ply - 1, played.san)}</strong>
      <span style={{ color: meta.color }}>{meta.label}</span>
      {other ? (
        <>
          <span className="muted">· best was {grade.best_san}</span>
          <button onClick={() => onSelect(ply, !withBest)}>{withBest ? 'Hide best move' : 'Show best move'}</button>
        </>
      ) : (
        grade.classification !== 'forced' && <span className="muted">· the engine's move too</span>
      )}
    </div>
  )
}

function formatAccuracy(value: number | null): string {
  return value === null ? '–' : value.toFixed(1)
}

function PracticeBox({
  practice,
  bestSan,
  context,
  onPreview,
  onTryAgain,
  onShowBest,
  onStop,
}: {
  practice: Practice
  bestSan: string | null
  /** The game up to and including the move being retried. */
  context: string[]
  onPreview: (move: MoveRef | null) => void
  onTryAgain: () => void
  onShowBest: () => void
  onStop: () => void
}) {
  const { status, attempt } = practice
  // The comment on a try is about the game with that move played instead.
  const tried = useMemo(() => (attempt ? [...context.slice(0, -1), attempt.uci] : undefined), [context, attempt])
  const text = {
    thinking: 'Your move: find something better on the board.',
    grading: 'Checking your move…',
    right: `${attempt && attempt.classification !== 'good' ? 'Yes! ' : ''}${attempt?.message ?? ''}`,
    // The comment already starts with the grade ("Mistake. ..."). An inaccuracy's comment ends by naming
    // the better move, which would give the answer away while practising.
    wrong: withoutAnswer(attempt?.message ?? (attempt ? GRADE_META[attempt.classification].label : '')),
    shown: `The best move was ${bestSan}. It's drawn on the board.`,
    error: "I couldn't reach the engine.",
  }[status]
  return (
    <div className={`practice ${status}`}>
      <p>
        <MoveRefText text={text} context={tried} onPreview={onPreview} />
      </p>
      <div className="moment-actions">
        {(status === 'wrong' || status === 'shown' || status === 'error') && (
          <button className="primary" onClick={onTryAgain}>
            Try again
          </button>
        )}
        {(status === 'thinking' || status === 'wrong') && <button onClick={onShowBest}>Show best move</button>}
        <button onClick={onStop}>{status === 'right' ? 'Done' : 'Stop'}</button>
      </div>
    </div>
  )
}

const GRAPH_W = 600
const GRAPH_H = 150

/** The student's winning chances over the game. Clicking it shows that move on the board. */
function EvalGraph({
  review,
  selected,
  onSelect,
}: {
  review: ReviewSnapshot
  selected: number | null
  onSelect: (ply: number | null) => void
}) {
  const chances = useMemo(() => winningChances(review), [review])
  const plies = review.plies.length
  if (plies === 0) return null
  const x = (i: number) => (i / plies) * GRAPH_W
  const y = (chance: number) => (1 - chance / 100) * GRAPH_H
  const line = chances.map((c, i) => `${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(' ')
  const area = `0,${GRAPH_H} ${line} ${GRAPH_W},${GRAPH_H}`
  const marks = keyMoments(review)

  const pick = (e: MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const ply = Math.round(((e.clientX - box.left) / box.width) * plies)
    onSelect(Math.min(plies, Math.max(1, ply)))
  }

  return (
    <figure className="eval-graph">
      <svg
        viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
        onClick={pick}
        role="img"
        aria-label="Your winning chances over the game. Click to see a move."
      >
        <rect width={GRAPH_W} height={GRAPH_H} className="eval-graph-bg" />
        <polygon points={area} className="eval-graph-area" />
        <line x1={0} x2={GRAPH_W} y1={GRAPH_H / 2} y2={GRAPH_H / 2} className="eval-graph-mid" />
        {selected !== null && <line x1={x(selected)} x2={x(selected)} y1={0} y2={GRAPH_H} className="eval-graph-cursor" />}
        {marks.map((g) => (
          <circle
            key={g.ply}
            cx={x(g.ply)}
            cy={y(chances[g.ply])}
            r={6}
            fill={GRADE_META[g.classification].color}
            stroke="#1d1b19"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <figcaption className="muted">Your winning chances, move by move. Click the graph to see that move.</figcaption>
    </figure>
  )
}
