import { useState } from 'react'
import type { Level } from '../api'
import type { Side } from '../useCoachGame'

interface NewGameProps {
  levels: Level[]
  initialLevel: string
  onStart: (color: Side | 'random', level: Level) => void
  onCancel?: () => void
}

export function NewGame({ levels, initialLevel, onStart, onCancel }: NewGameProps) {
  const [color, setColor] = useState<Side | 'random'>('white')
  const [levelId, setLevelId] = useState(initialLevel)
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
      <div className="row">
        <button className="primary" disabled={!level} onClick={() => level && onStart(color, level)}>
          Start game
        </button>
        {onCancel && <button onClick={onCancel}>Cancel</button>}
      </div>
    </section>
  )
}
