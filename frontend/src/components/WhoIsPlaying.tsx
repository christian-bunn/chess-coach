import { useState, type FormEvent } from 'react'
import { validName } from '../player'

interface WhoIsPlayingProps {
  /** The player now, when switching (the name starts filled in, and there's a Cancel). */
  current: string | null
  onChoose: (name: string) => void
  onCancel?: () => void
}

/** Asks for the player's name: their progress is kept under it, apart from everyone else's. */
export function WhoIsPlaying({ current, onChoose, onCancel }: WhoIsPlayingProps) {
  const [name, setName] = useState(current ?? '')
  const ok = validName(name)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ok) onChoose(name.trim())
  }
  return (
    <div className="overlay">
      <form className="who-is-playing" onSubmit={submit} aria-label="Who's playing?">
        <h2>Who's playing?</h2>
        <p className="muted">
          Your puzzles, saved games and openings are kept under your name, apart from anyone else's. Use the same
          name next time to carry on where you left off.
        </p>
        <input
          className="player-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={40}
          autoFocus
          aria-label="Your name"
        />
        {current && <p className="muted">Switching player starts a new game.</p>}
        <div className="who-actions">
          <button type="submit" className="primary" disabled={!ok}>
            {current ? 'Switch' : 'Start'}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
