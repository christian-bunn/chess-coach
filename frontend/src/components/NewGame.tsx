import { useState } from 'react'
import type { Level } from '../api'
import type { Side } from '../useCoachGame'

interface NewGameProps {
  levels: Level[]
  initialLevel: string
  /** Whether the last game was coached, so the choice carries over. */
  initialAssisted: boolean
  onStart: (color: Side | 'random', level: Level, assisted: boolean) => void
  onCancel?: () => void
}

export function NewGame({ levels, initialLevel, initialAssisted, onStart, onCancel }: NewGameProps) {
  const [color, setColor] = useState<Side | 'random'>('white')
  const [levelId, setLevelId] = useState(initialLevel)
  const [assisted, setAssisted] = useState(initialAssisted)
  const level = levels.find((l) => l.id === levelId) ?? levels[0]

  return (
    <section className="new-game" aria-label="New game">
      <h2>New game</h2>
      <fieldset>
        <legend>Play as</legend>
        <div className="segmented">
          {(['white', 'random', 'black'] as const).map((c) => (
            <button key={c} className={color === c ? 'active' : ''} onClick={() => setColor(c)}>
              {c === 'white' ? '♔ White' : c === 'black' ? '♚ Black' : '⚄ Random'}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Opponent</legend>
        <div className="levels">
          {levels.map((l) => (
            <button key={l.id} className={l.id === levelId ? 'active' : ''} onClick={() => setLevelId(l.id)}>
              <strong>{l.name}</strong>
              <span>~{l.elo}</span>
            </button>
          ))}
        </div>
        {level && <p className="muted">{level.description}</p>}
      </fieldset>
      <fieldset>
        <legend>Coach</legend>
        <div className="segmented">
          <button className={assisted ? 'active' : ''} onClick={() => setAssisted(true)}>
            🎓 Coached
          </button>
          <button className={assisted ? '' : 'active'} onClick={() => setAssisted(false)}>
            ⚔ Unassisted
          </button>
        </div>
        <p className="muted">
          {assisted
            ? 'Grades, comments, hints, retries and take-backs as you play.'
            : 'A real game: no hints, take-backs, comments, grades or evaluation until it\'s over. Then the review shows how it went, and your mistakes still become puzzles.'}
        </p>
      </fieldset>
      <div className="row">
        <button className="primary" disabled={!level} onClick={() => level && onStart(color, level, assisted)}>
          Start game
        </button>
        {onCancel && <button onClick={onCancel}>Cancel</button>}
      </div>
    </section>
  )
}
