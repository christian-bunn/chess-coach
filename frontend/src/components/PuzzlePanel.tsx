import type { MoveGrade, Puzzle, PuzzleSummary } from '../api'
import { GRADE_META } from '../grades'
import { moveLabel } from '../useCoachGame'
import type { PuzzleStatus } from '../usePuzzles'

interface PuzzlePanelProps {
  summary: PuzzleSummary | null
  puzzle: Puzzle | null
  status: PuzzleStatus
  attempt: MoveGrade | null
  /** The puzzle as rescheduled after this review (null until the first answer). */
  scheduled: Puzzle | null
  loading: boolean
  /** Load the next due puzzle; `early` for one that isn't due yet. */
  onStart: (early: boolean) => void
  onTryAgain: () => void
  onShowSolution: () => void
  onRemove: () => void
  /** How many moves have been played on from the finished puzzle; taking one back, and going back to its start. */
  explored: number
  onUndoExplore: () => void
  onResetExplore: () => void
}

/** "in 5 hours", "tomorrow", "in 3 days". */
function fromNow(iso: string): string {
  const hours = Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000)
  if (hours < 1) return 'in under an hour'
  if (hours < 20) return `in ${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.max(1, Math.round(hours / 24))
  return days === 1 ? 'tomorrow' : `in ${days} days`
}

export function PuzzlePanel({
  summary,
  puzzle,
  status,
  attempt,
  scheduled,
  loading,
  onStart,
  onTryAgain,
  onShowSolution,
  onRemove,
  explored,
  onUndoExplore,
  onResetExplore,
}: PuzzlePanelProps) {
  return (
    <section className="puzzles" aria-label="Puzzles from your mistakes">
      <div className="review-head">
        <h2>Learn from your mistakes</h2>
      </div>
      {summary && summary.total > 0 && (
        <p className="muted puzzle-summary">
          {summary.due} due now · {summary.total} saved · {summary.mastered} mastered
        </p>
      )}
      <div className="review-body">
        {puzzle ? (
          <PuzzleCard
            puzzle={puzzle}
            status={status}
            attempt={attempt}
            scheduled={scheduled}
            onNext={() => onStart(false)}
            onTryAgain={onTryAgain}
            onShowSolution={onShowSolution}
            onRemove={onRemove}
            explored={explored}
            onUndoExplore={onUndoExplore}
            onResetExplore={onResetExplore}
          />
        ) : loading ? (
          <p className="muted">Loading…</p>
        ) : !summary || summary.total === 0 ? (
          <p>
            Your mistakes, missed wins and blunders from games are saved here as puzzles, from the position before
            your move. Each one comes back the next day, then less and less often as you solve it: after 3 days, a
            week, two weeks, a month. A miss brings it back the next day.
          </p>
        ) : summary.due > 0 ? (
          <div className="moment-actions">
            <button className="primary" onClick={() => onStart(false)}>
              Start ({summary.due} due)
            </button>
          </div>
        ) : (
          <>
            <p>
              Nothing due right now.
              {summary.next_due && ` The next puzzle comes back ${fromNow(summary.next_due)}.`}
            </p>
            <div className="moment-actions">
              <button onClick={() => onStart(true)}>Do one early</button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function PuzzleCard({
  puzzle,
  status,
  attempt,
  scheduled,
  onNext,
  onTryAgain,
  onShowSolution,
  onRemove,
  explored,
  onUndoExplore,
  onResetExplore,
}: {
  puzzle: Puzzle
  status: PuzzleStatus
  attempt: MoveGrade | null
  scheduled: Puzzle | null
  onNext: () => void
  onTryAgain: () => void
  onShowSolution: () => void
  onRemove: () => void
  explored: number
  onUndoExplore: () => void
  onResetExplore: () => void
}) {
  const finished = status === 'right' || status === 'shown'
  const index = puzzle.moves.length
  const meta = GRADE_META[puzzle.grade]
  // An inaccuracy's comment ends by naming the better move, which would give the answer away.
  const attemptText = attempt?.message?.replace(` ${attempt.best_san} was better.`, '') ?? ''
  const schedule = scheduled
    ? scheduled.streak > 0
      ? `Next review ${fromNow(scheduled.due)}.`
      : 'This one comes back tomorrow.'
    : null
  return (
    <div className={`moment puzzle ${status}`}>
      <div className="moment-head">
        <span className="badge small" style={{ background: meta.color }}>
          {meta.symbol}
        </span>
        <strong>{puzzle.color === 'white' ? 'White' : 'Black'} to move</strong>
        {puzzle.opening && <span className="muted">· {puzzle.opening}</span>}
      </div>
      <p>
        In your game you played <strong>{moveLabel(index, puzzle.played_san)}</strong> here, a{' '}
        {meta.label.toLowerCase()}. Find a better move.
      </p>
      <div className="practice">
        <p>
          {
            {
              thinking: 'Your move.',
              grading: 'Checking your move…',
              right: `Correct! ${attemptText}`,
              wrong: attemptText,
              shown: `The move was ${moveLabel(index, puzzle.best_san)}. It's drawn on the board.`,
              error: "I couldn't reach the engine.",
            }[status]
          }
        </p>
        {finished && puzzle.comment && (
          <p className="muted">In the game: {puzzle.comment}</p>
        )}
        {schedule && <p className="muted">{schedule}</p>}
        {finished && (
          <p className="muted">
            Play on with either side to explore the position. The evaluation bar follows along.
          </p>
        )}
        <div className="moment-actions">
          {(status === 'wrong' || status === 'error') && (
            <button className="primary" onClick={onTryAgain}>
              Try again
            </button>
          )}
          {(status === 'thinking' || status === 'wrong') && <button onClick={onShowSolution}>Show solution</button>}
          {finished && (
            <>
              <button className="primary" onClick={onNext}>
                Next puzzle
              </button>
              <button onClick={onUndoExplore} disabled={explored === 0} title="Take back the last move you explored">
                ↶ Undo
              </button>
              <button onClick={onResetExplore} disabled={explored === 0} title="Back to the puzzle position">
                Reset
              </button>
            </>
          )}
        </div>
      </div>
      <button type="button" className="link puzzle-remove" onClick={onRemove}>
        Remove this puzzle
      </button>
    </div>
  )
}
