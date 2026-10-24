import { useState } from 'react'
import type { Level } from '../api'
import type { Assistance, Side } from '../useCoachGame'

const MODES: { id: Assistance; label: string; about: string }[] = [
  { id: 'coached', label: '🎓 Coached', about: 'Grades, comments, hints, retries and take-backs as you play.' },
  {
    id: 'graded',
    label: '📊 Graded',
    about: "Every move's grade, yours and your opponent's, and the evaluation bar, but no hints, take-backs or comments.",
  },
  {
    id: 'unassisted',
    label: '⚔ Unassisted',
    about:
      "A real game: no hints, take-backs, comments, grades or evaluation until it's over. Then the review shows how " +
      'it went, and your mistakes still become puzzles.',
  },
]

interface NewGameProps {
  levels: Level[]
  initialLevel: string
  /** The last game's mode, so the choice carries over. */
  initialAssistance: Assistance
  onStart: (color: Side | 'random', level: Level, assistance: Assistance) => void
  onCancel?: () => void
}

export function NewGame({ levels, initialLevel, initialAssistance, onStart, onCancel }: NewGameProps) {
  const [color, setColor] = useState<Side | 'random'>('white')
  const [levelId, setLevelId] = useState(initialLevel)
  const [assistance, setAssistance] = useState(initialAssistance)
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
          {MODES.map((m) => (
            <button key={m.id} className={assistance === m.id ? 'active' : ''} onClick={() => setAssistance(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="muted">{MODES.find((m) => m.id === assistance)?.about}</p>
      </fieldset>
      <div className="row">
        <button className="primary" disabled={!level} onClick={() => level && onStart(color, level, assistance)}>
          Start game
        </button>
        {onCancel && <button onClick={onCancel}>Cancel</button>}
      </div>
    </section>
  )
}
