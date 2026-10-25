import type { Classification, MoveGrade, Puzzle, PuzzleSummary } from '../api'
import { GRADE_META } from '../grades'
import { fromNow } from '../time'
import { moveLabel, type Ply } from '../useCoachGame'
import type { PuzzleStatus } from '../usePuzzles'
import { MoveList } from './MoveList'

/** The game played on from a solved puzzle: its moves, and how it stands ("Your move.", "Checkmate. You win!"). */
export interface PlayOn {
  plies: Ply[]
  status: string
}

interface PuzzlePanelProps {
  summary: PuzzleSummary | null
  /** Every puzzle, the soonest due first (null while loading). */
  list: Puzzle[] | null
  puzzle: Puzzle | null
  status: PuzzleStatus
  attempt: MoveGrade | null
  /** The puzzle as rescheduled after this review (null until the first answer). */
  scheduled: Puzzle | null
  loading: boolean
  playOn: PlayOn | null
  /** The puzzle due longest ago (or back to the list if none is due). */
  onNext: () => void
  onOpen: (id: string) => void
  onClose: () => void
  onTryAgain: () => void
  onShowSolution: () => void
  onRemove: () => void
}


const MASTERED_STREAK = 4

// What the game move was. A puzzle can also come from a decent move that missed a mate.
const GRADE_PHRASES: Partial<Record<Classification, string>> = {
  blunder: 'a blunder',
  mistake: 'a mistake',
  miss: 'a missed win',
  inaccuracy: 'an inaccuracy',
}
function gradePhrase(grade: Classification): string {
  return GRADE_PHRASES[grade] ?? 'playable, but there was something much stronger'
}

export function PuzzlePanel(props: PuzzlePanelProps) {
  const { summary, list, puzzle, loading, onNext, onOpen, onClose } = props
  return (
    <section className="puzzles" aria-label="Puzzles from your mistakes">
      <div className="review-head">
        <h2>Learn from your mistakes</h2>
        {puzzle && <button onClick={onClose}>← All puzzles</button>}
      </div>
      {summary && summary.total > 0 && (
        <p className="muted puzzle-summary">
          {summary.due} due now · {summary.total} saved · {summary.mastered} mastered
        </p>
      )}
      <div className="review-body">
        {puzzle ? (
          <PuzzleCard {...props} puzzle={puzzle} />
        ) : loading || list === null ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <p>
            Your mistakes, missed wins and blunders from games are saved here as puzzles, from the position before
            your move. Each one comes back the next day, then less and less often as you solve it: after 3 days, a
            week, two weeks, a month. A miss brings it back the next day.
          </p>
        ) : (
          <>
            {!!summary?.due && (
              <div className="moment-actions">
                <button className="primary" onClick={onNext}>
                  Start the due puzzles ({summary.due})
                </button>
              </div>
            )}
            <ol className="moments">
              {list.map((p) => {
                const meta = GRADE_META[p.grade]
                const due = new Date(p.due).getTime() <= Date.now()
                return (
                  <li key={p.id} className={`moment puzzle-item ${due ? 'due' : ''}`}>
                    <button type="button" className="moment-head" onClick={() => onOpen(p.id)} title="Do this puzzle">
                      <span className="badge small" style={{ background: meta.color }}>
                        {meta.symbol}
                      </span>
                      <strong>{p.color === 'white' ? 'White' : 'Black'} to move</strong>
                      {p.opening && <span className="muted">· {p.opening}</span>}
                    </button>
                    <p className="muted">
                      In your game: {moveLabel(p.moves.length, p.played_san)}, {gradePhrase(p.grade)}.{' '}
                      {due ? <strong className="due-now">Due now</strong> : `Next review ${fromNow(p.due)}`}
                      {p.streak >= MASTERED_STREAK && ' · mastered'}
                    </p>
                  </li>
                )
              })}
            </ol>
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
  playOn,
  onNext,
  onTryAgain,
  onShowSolution,
  onRemove,
}: PuzzlePanelProps & { puzzle: Puzzle }) {
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
        In your game you played <strong>{moveLabel(index, puzzle.played_san)}</strong> here, {gradePhrase(puzzle.grade)}.
        Find a better move.
      </p>
      <div className="practice">
        <p>
          {
            {
              thinking: 'Your move.',
              grading: 'Checking your move…',
              right: `Correct! ${attemptText}`,
              wrong: attemptText,
              shown: `The move was ${moveLabel(index, puzzle.best_san)}. It's drawn on the board: play it, and your opponent plays on.`,
              error: "I couldn't reach the engine.",
            }[status]
          }
        </p>
        {finished && puzzle.comment && <p className="muted">In the game: {puzzle.comment}</p>}
        {schedule && <p className="muted">{schedule}</p>}
        {playOn && (
          <div className="play-on">
            <p>
              <strong>Playing on</strong> <span className="muted">· graded, against your last game's opponent</span>
            </p>
            <p>{playOn.status}</p>
            <MoveList plies={playOn.plies} />
          </div>
        )}
        <div className="moment-actions">
          {(status === 'wrong' || status === 'error') && (
            <button className="primary" onClick={onTryAgain}>
              Try again
            </button>
          )}
          {(status === 'thinking' || status === 'wrong') && <button onClick={onShowSolution}>Show solution</button>}
          {finished && (
            <button className="primary" onClick={onNext}>
              Next puzzle
            </button>
          )}
        </div>
      </div>
      <button type="button" className="link puzzle-remove" onClick={onRemove}>
        Remove this puzzle
      </button>
    </div>
  )
}
