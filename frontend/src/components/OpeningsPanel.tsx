import { useMemo } from 'react'
import type { OpeningLine, RepertoireEntry } from '../api'
import { fromNow } from '../time'
import { moveLabel } from '../useCoachGame'
import { numbered, sans, sideOf, type OpeningSide, type useOpenings } from '../useOpenings'

type Openings = ReturnType<typeof useOpenings>

interface OpeningsPanelProps {
  openings: Openings
  /** Start a game against the computer from the position after `moves`, playing `side`. */
  onPlayFrom: (moves: string[], side: OpeningSide, name: string) => void
  /** A game is in progress, so playing from here waits for a yes. */
  confirmingPlay: boolean
  onConfirmPlay: () => void
  onCancelPlay: () => void
}

const SIDE_NAMES: Record<OpeningSide, string> = { white: 'White', black: 'Black' }
const MASTERED_STREAK = 4

const isDue = (entry: RepertoireEntry) => new Date(entry.due).getTime() <= Date.now()

/** The Openings page: pick an opening, explore its book moves, practise it from memory, keep a repertoire. */
export function OpeningsPanel(props: OpeningsPanelProps) {
  const { openings, confirmingPlay, onConfirmPlay, onCancelPlay } = props
  const { line } = openings
  return (
    <section className="puzzles" aria-label="Learn openings">
      <div className="review-head">
        <h2>{line ? line.name : 'Learn openings'}</h2>
        {line && <button onClick={openings.close}>← All openings</button>}
      </div>
      {confirmingPlay && (
        <div className="practice wrong">
          <p>Your game in progress will be replaced. Play from here anyway?</p>
          <div className="moment-actions">
            <button className="primary" onClick={onConfirmPlay}>
              Yes, play from here
            </button>
            <button onClick={onCancelPlay}>Keep my game</button>
          </div>
        </div>
      )}
      {line ? (
        <>
          <p className="muted puzzle-summary">
            {line.eco} · {line.pgn}
          </p>
          <div className="review-body">
            {openings.practice ? <Practice {...props} line={line} /> : <Explore {...props} line={line} />}
          </div>
        </>
      ) : (
        <Choose openings={openings} />
      )}
    </section>
  )
}

function Choose({ openings }: { openings: Openings }) {
  const { featured, query, setQuery, results, choose, repertoire, practiseEntry } = openings
  const item = (l: OpeningLine) => (
    <li key={`${l.eco} ${l.pgn}`}>
      <button type="button" className="opening-item" onClick={() => choose(l)}>
        <strong>{l.name}</strong>
        <span className="muted">
          {l.eco} · {l.pgn}
        </span>
      </button>
    </li>
  )
  const entries = repertoire?.entries ?? []
  const due = entries.filter(isDue)
  return (
    <>
      <input
        className="opening-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search all 3,865 named lines, e.g. Najdorf or C50"
        aria-label="Search openings"
      />
      <div className="review-body">
        {results ? (
          results.length === 0 ? (
            <p className="muted">No opening matches “{query}”.</p>
          ) : (
            <ol className="opening-list">{results.map(item)}</ol>
          )
        ) : featured === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <h3 className="opening-group">My repertoire</h3>
            {entries.length === 0 ? (
              <p className="muted">
                Openings you add come back for practice on a schedule: due straight away, then a day after a clean
                run, then 3 days, a week, two weeks… A run with a mistake brings it back the next day.
              </p>
            ) : (
              <>
                {due.length > 0 && (
                  <div className="moment-actions">
                    <button className="primary" onClick={() => practiseEntry(due[0])}>
                      ▶ Practise the due openings ({due.length})
                    </button>
                  </div>
                )}
                <ol className="opening-list">
                  {entries.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        className={`opening-item ${isDue(e) ? 'due' : ''}`}
                        onClick={() => practiseEntry(e)}
                        title="Practise this opening"
                      >
                        <strong>{e.name}</strong>
                        <span className="muted">as {SIDE_NAMES[e.side]}</span>
                        <span className="muted">
                          {isDue(e) ? <strong className="due-now">Due now</strong> : `Next review ${fromNow(e.due)}`}
                          {e.streak >= MASTERED_STREAK && ' · mastered'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <p className="muted">
              Pick an opening to see its book moves at every step, then practise it: you play your side from memory and
              the computer plays the other side's book moves, a different variation each time.
            </p>
            {featured.map((g) => (
              <div key={g.group}>
                <h3 className="opening-group">{g.group}</h3>
                <ol className="opening-list">{g.lines.map(item)}</ol>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  )
}

/** Adding the opening to the repertoire for a side, or where it stands there. */
function RepertoireButtons({ openings, line }: { openings: Openings; line: OpeningLine }) {
  const { entryFor, addToRepertoire, removeFromRepertoire } = openings
  const natural = sideOf(line)
  return (
    <div className="moment-actions repertoire-row">
      {(['white', 'black'] as const).map((side) => {
        const entry = entryFor(line.moves, side)
        return entry ? (
          <span key={side} className="in-repertoire">
            ★ In your repertoire as {SIDE_NAMES[side]} · next review {fromNow(entry.due)}
            <button type="button" className="link" onClick={() => void removeFromRepertoire(entry.id)}>
              Remove
            </button>
          </span>
        ) : (
          <button key={side} className={side === natural ? '' : 'link'} onClick={() => void addToRepertoire(side)}>
            ☆ Add to my repertoire as {SIDE_NAMES[side]}
          </button>
        )
      })}
    </div>
  )
}

function Explore({ openings, line, onPlayFrom }: OpeningsPanelProps & { line: OpeningLine }) {
  const { path, at, current, position, step, explore, setHover, startPractice } = openings
  const pathSans = useMemo(() => sans(path), [path])
  const natural = sideOf(line)
  return (
    <>
      <div className="opening-path">
        {pathSans.length === 0 ? (
          <span className="muted">The starting position.</span>
        ) : (
          pathSans.map((san, i) => (
            <button
              key={i}
              type="button"
              className={`move ${i === at - 1 ? 'current' : ''} ${i >= at ? 'ahead' : ''}`}
              onClick={() => step(i + 1)}
              title="Show this position"
            >
              {i % 2 === 0 ? `${i / 2 + 1}. ` : ''}
              {san}
            </button>
          ))
        )}
      </div>
      <div className="move-nav" aria-label="Step through the line">
        <button onClick={() => step(0)} disabled={at === 0} title="Starting position">
          ⏮
        </button>
        <button onClick={() => step(at - 1)} disabled={at === 0} title="Previous move (←)">
          ◀
        </button>
        <button onClick={() => step(at + 1)} disabled={at >= path.length} title="Next move (→)">
          ▶
        </button>
        <button onClick={() => step(path.length)} disabled={at >= path.length} title="End of the line">
          ⏭
        </button>
      </div>
      <p>
        {position?.opening ? (
          <>
            Here: <strong>{position.opening.name}</strong> <span className="muted">· {position.opening.eco}</span>
          </>
        ) : (
          <span className="muted">{at === 0 ? 'Any first move starts an opening.' : 'Out of the named lines.'}</span>
        )}
      </p>
      <h3 className="opening-group">Book moves from here</h3>
      {position === null ? (
        <p className="muted">Loading…</p>
      ) : position.moves.length === 0 ? (
        <p className="muted">
          The named lines end here. Step back (◀) to see the other book moves along the way, or play on with your own
          moves.
        </p>
      ) : (
        <ol className="opening-list book-moves">
          {position.moves.map((m) => (
            <li key={m.uci}>
              <button
                type="button"
                className="opening-item"
                onClick={() => explore(m.uci)}
                onMouseEnter={() => setHover(m.uci)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(m.uci)}
                onBlur={() => setHover(null)}
              >
                <strong>{moveLabel(at, m.san)}</strong>
                <span>{m.name}</span>
                {path[at] === m.uci && <span className="badge-line">this line</span>}
                <span className="muted">
                  {m.lines} line{m.lines === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="muted">Click a book move, or make any move on the board. The most played lines come first.</p>
      <div className="moment-actions">
        {(['white', 'black'] as const).map((side) => (
          <button key={side} className={side === natural ? 'primary' : ''} onClick={() => startPractice(side)}>
            ▶ Practise as {SIDE_NAMES[side]}
          </button>
        ))}
        <button
          onClick={() => onPlayFrom(current, natural, position?.opening?.name ?? line.name)}
          title="Play a game against the computer from this position"
        >
          ♟ Play from here as {SIDE_NAMES[natural]}
        </button>
      </div>
      <RepertoireButtons openings={openings} line={line} />
    </>
  )
}

function Practice({ openings, line, onPlayFrom }: OpeningsPanelProps & { line: OpeningLine }) {
  const { practice, showAnswer, stopPractice, startPractice, goOverPractice, nextDue, practiseEntry, addToRepertoire, entryFor } =
    openings
  const played = useMemo(() => sans(practice?.moves ?? []), [practice?.moves])
  if (!practice) return null
  const yours = played.filter((_, i) => (i % 2 === 0) === (practice.side === 'white')).length
  const answer = practice.options[0]
  const done = practice.status === 'done'
  const text = {
    checking: '…',
    thinking: 'Your move: play the book move.',
    opponent: 'Your opponent plays a book move…',
    wrong: `${practice.wrong} isn't one of this opening's book moves here. Try again.`,
    done: `Line complete! You played ${yours} book move${yours === 1 ? '' : 's'} with ${practice.mistakes} mistake${practice.mistakes === 1 ? '' : 's'}.`,
    error: "I couldn't reach the backend.",
  }[practice.status]
  const review = practice.review
  const following = done ? nextDue() : null
  return (
    <div className={`practice ${done ? 'right' : practice.status}`}>
      <p>
        Practising <strong>{line.name}</strong> as {SIDE_NAMES[practice.side]}. You play your side's book moves; the
        computer plays the other side's, a different variation each time.
      </p>
      <p>{text}</p>
      {practice.shown && answer && (practice.status === 'thinking' || practice.status === 'wrong') && (
        <p className="muted">
          The book move: <strong>{moveLabel(practice.moves.length, answer.san)}</strong>
          {practice.options.length > 1 &&
            ` (also ${practice.options
              .slice(1, 4)
              .map((o) => o.san)
              .join(', ')})`}
          . It's drawn on the board.
        </p>
      )}
      {done && review && (
        <p className="muted">
          {review.counted
            ? practice.mistakes === 0
              ? `★ A clean run: it comes back ${fromNow(review.entry.due)}.`
              : `It comes back ${fromNow(review.entry.due)}, to go over again.`
            : `Not due yet, so this run doesn't change its schedule (next review ${fromNow(review.entry.due)}).`}
        </p>
      )}
      {played.length > 0 && <p className="muted opening-played">{numbered(played)}</p>}
      <div className="moment-actions">
        {(practice.status === 'thinking' || practice.status === 'wrong') && !practice.shown && (
          <button onClick={showAnswer}>Show me</button>
        )}
        {done || practice.status === 'error' ? (
          <>
            {following ? (
              <button className="primary" onClick={() => practiseEntry(following)}>
                ▶ Next due: {following.name}
              </button>
            ) : (
              <button className="primary" onClick={() => startPractice(practice.side, practice.target)}>
                ↻ Practise again
              </button>
            )}
            <button
              onClick={() => onPlayFrom(practice.moves, practice.side, line.name)}
              title="Play a game against the computer from where the line ended"
            >
              ♟ Play on from here
            </button>
            <button onClick={goOverPractice} title="Step through the line you just played, with the other book moves at each point">
              Go over this line
            </button>
            {!entryFor(practice.target, practice.side) && (
              <button onClick={() => void addToRepertoire(practice.side)}>☆ Add to my repertoire</button>
            )}
            <button onClick={stopPractice}>Back to the opening</button>
          </>
        ) : (
          <button onClick={stopPractice}>Stop</button>
        )}
      </div>
    </div>
  )
}
