import { useState } from 'react'
import type { SavedGameSummary } from '../api'

interface SavedGamesProps {
  games: SavedGameSummary[] | null
  onOpen: (id: string) => void
  onDelete: (id: string) => void
}

const MODE_LABELS: Record<string, string> = { coached: '🎓 Coached', graded: '📊 Graded', unassisted: '⚔ Unassisted' }

/** "24 Oct 2026, 9:41 am" */
export function savedOn(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

/** "You (White) vs Casual (~1400)" */
export function matchup(game: SavedGameSummary): string {
  return `You (${game.color === 'white' ? 'White' : 'Black'}) vs ${game.opponent ?? 'the computer'}`
}

/** The games saved from the game review, newest first. */
export function SavedGames({ games, onOpen, onDelete }: SavedGamesProps) {
  // Deleting can't be undone, so it takes a second click.
  const [confirming, setConfirming] = useState<string | null>(null)
  return (
    <section className="puzzles" aria-label="Saved games">
      <div className="review-head">
        <h2>Saved games</h2>
      </div>
      <div className="review-body">
        {games === null ? (
          <p className="muted">Loading…</p>
        ) : games.length === 0 ? (
          <p>
            No saved games yet. In the game review, <strong>💾 Save game</strong> keeps a game here, with its grades,
            evaluation graph and key moments, so you can go over it again later.
          </p>
        ) : (
          <ol className="moments">
            {games.map((g) => (
              <li key={g.id} className="moment saved-game">
                <button type="button" className="moment-head" onClick={() => onOpen(g.id)} title="Open the review">
                  <strong>{matchup(g)}</strong>
                </button>
                <p className="muted">
                  {savedOn(g.saved)}
                  {g.assistance && MODE_LABELS[g.assistance] && ` · ${MODE_LABELS[g.assistance]}`}
                  {` · ${Math.ceil(g.moves / 2)} moves`}
                </p>
                <p>
                  {g.result ?? 'Saved before the end of the game.'}
                  {g.opening && <span className="muted"> · 📖 {g.opening}</span>}
                </p>
                {g.accuracy !== null && (
                  <p className="muted">
                    Accuracy: you {g.accuracy.toFixed(1)}
                    {g.opponent_accuracy !== null && `, opponent ${g.opponent_accuracy.toFixed(1)}`}
                  </p>
                )}
                <div className="moment-actions">
                  <button className="primary" onClick={() => onOpen(g.id)}>
                    Open review
                  </button>
                  {confirming === g.id ? (
                    <>
                      <button onClick={() => onDelete(g.id)}>Delete for good</button>
                      <button onClick={() => setConfirming(null)}>Keep it</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirming(g.id)}>Delete</button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
