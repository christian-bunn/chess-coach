import { useMemo } from 'react'
import type { OpeningLine } from '../api'
import { moveLabel } from '../useCoachGame'
import { sans, sideOf, type OpeningSide, type useOpenings } from '../useOpenings'

type Openings = ReturnType<typeof useOpenings>

const SIDE_NAMES: Record<OpeningSide, string> = { white: 'White', black: 'Black' }

/** "1. e4 e5 2. Nf3" from SAN moves, numbered from the start. */
function numbered(moves: string[]): string {
  return moves.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(' ')
}

/** The Openings page: pick an opening, explore its book moves, practise it from memory. */
export function OpeningsPanel({ openings }: { openings: Openings }) {
  const { line } = openings
  return (
    <section className="puzzles" aria-label="Learn openings">
      <div className="review-head">
        <h2>{line ? line.name : 'Learn openings'}</h2>
        {line && <button onClick={openings.close}>← All openings</button>}
      </div>
      {line ? (
        <>
          <p className="muted puzzle-summary">
            {line.eco} · {line.pgn}
          </p>
          <div className="review-body">
            {openings.practice ? <Practice openings={openings} line={line} /> : <Explore openings={openings} line={line} />}
          </div>
        </>
      ) : (
        <Choose openings={openings} />
      )}
    </section>
  )
}

function Choose({ openings }: { openings: Openings }) {
  const { featured, query, setQuery, results, choose } = openings
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

function Explore({ openings, line }: { openings: Openings; line: OpeningLine }) {
  const { path, at, position, step, explore, setHover, startPractice } = openings
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
        <p className="muted">No named line goes further from here. Step back, or play on with your own moves.</p>
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
      </div>
    </>
  )
}

function Practice({ openings, line }: { openings: Openings; line: OpeningLine }) {
  const { practice, showAnswer, stopPractice, startPractice, exploreFromPractice } = openings
  const played = useMemo(() => sans(practice?.moves ?? []), [practice?.moves])
  if (!practice) return null
  const yours = played.filter((_, i) => (i % 2 === 0) === (practice.side === 'white')).length
  const answer = practice.options[0]
  const text = {
    checking: '…',
    thinking: 'Your move: play the book move.',
    opponent: 'Your opponent plays a book move…',
    wrong: `${practice.wrong} isn't one of this opening's book moves here. Try again.`,
    done: `Line complete! You played ${yours} book move${yours === 1 ? '' : 's'} with ${practice.mistakes} mistake${practice.mistakes === 1 ? '' : 's'}.`,
    error: "I couldn't reach the backend.",
  }[practice.status]
  return (
    <div className={`practice ${practice.status === 'done' ? 'right' : practice.status}`}>
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
      {played.length > 0 && <p className="muted opening-played">{numbered(played)}</p>}
      <div className="moment-actions">
        {(practice.status === 'thinking' || practice.status === 'wrong') && !practice.shown && (
          <button onClick={showAnswer}>Show me</button>
        )}
        {practice.status === 'done' || practice.status === 'error' ? (
          <>
            <button className="primary" onClick={() => startPractice(practice.side)}>
              ↻ Practise again
            </button>
            <button onClick={exploreFromPractice}>Explore this position</button>
            <button onClick={stopPractice}>Back to the opening</button>
          </>
        ) : (
          <button onClick={stopPractice}>Stop</button>
        )}
      </div>
    </div>
  )
}
