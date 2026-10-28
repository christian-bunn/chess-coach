import { useState } from 'react'
import type { FriendChallenge, FriendHelp } from '../api'
import { TIME_CONTROLS, UNTIMED, timeControl } from '../clock'
import type { Side } from '../useCoachGame'
import type { FriendGame } from '../useFriendGame'
import { friendResult } from '../useFriendGame'
import { MoveList } from './MoveList'

const HELP: { id: FriendHelp; label: string; about: string }[] = [
  {
    id: 'graded',
    label: '📊 Graded',
    about: "Every move's grade and the evaluation bar, for both of you, as you play.",
  },
  {
    id: 'unassisted',
    label: '⚔ Unassisted',
    about: "A real game: no grades or evaluation until it's over. Then you each get the game review.",
  },
]

function timeLabel(id: string): string {
  return timeControl(id)?.label ?? 'Untimed'
}

function helpLabel(id: FriendHelp): string {
  return HELP.find((h) => h.id === id)?.label ?? id
}

/** What a challenge means for whoever joins it. */
function colourFor(c: FriendChallenge): string {
  if (c.color === 'random') return 'colours drawn at random'
  return `you'd play ${c.color === 'white' ? 'Black' : 'White'}`
}

interface FriendPanelProps {
  friend: FriendGame
  onReview: () => void
  onFlip: () => void
}

/** Playing a friend: the lobby of challenges, waiting for someone to join, the game, and how it ended. */
export function FriendPanel({ friend, onReview, onFlip }: FriendPanelProps) {
  const { view, lobby, error } = friend
  if (!view) return <Lobby friend={friend} challenges={lobby?.challenges ?? null} error={error} />
  if (view.status === 'waiting') {
    return (
      <section className="new-game friend" aria-label="Waiting for your friend">
        <h2>Waiting for someone to join…</h2>
        <p>
          Your challenge: {timeLabel(view.time_control)} · {helpLabel(view.help)} ·{' '}
          {view.host_color === 'random' ? 'colours drawn at random' : `you play ${view.host_color}`}.
        </p>
        <p className="muted">
          Your friend sees it under 👥 Friend, once they've opened the coach (the link from <code>./share.sh</code>) and
          typed their name. The game starts as soon as they join.
        </p>
        {error && <p className="friend-error">{error}</p>}
        <div className="row">
          <button onClick={() => void friend.leave()}>Take it back</button>
        </div>
      </section>
    )
  }
  return <Game friend={friend} onReview={onReview} onFlip={onFlip} />
}

function Lobby({ friend, challenges, error }: { friend: FriendGame; challenges: FriendChallenge[] | null; error: string | null }) {
  const [color, setColor] = useState<Side | 'random'>('white')
  const [help, setHelp] = useState<FriendHelp>('graded')
  const [timing, setTiming] = useState('10')
  return (
    <section className="new-game friend" aria-label="Play a friend">
      <h2>Play a friend</h2>
      <p className="muted">
        Join a challenge, or post your own for your friend to join. They open the coach from the link{' '}
        <code>./share.sh</code> prints and type their own name.
      </p>
      {error && <p className="friend-error">{error}</p>}
      <h3>Challenges</h3>
      {challenges === null ? (
        <p className="muted">Looking…</p>
      ) : challenges.length === 0 ? (
        <p className="muted">None yet. They show up here as soon as someone posts one.</p>
      ) : (
        <ul className="challenges">
          {challenges.map((c) => (
            <li key={c.id}>
              <span>
                <strong>{c.name}</strong> · {timeLabel(c.time_control)} · {helpLabel(c.help)} · {colourFor(c)}
              </span>
              <button className="primary" onClick={() => void friend.join(c.id)}>
                Join
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3>Post a challenge</h3>
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
        <legend>Help</legend>
        <div className="segmented">
          {HELP.map((h) => (
            <button key={h.id} className={help === h.id ? 'active' : ''} onClick={() => setHelp(h.id)}>
              {h.label}
            </button>
          ))}
        </div>
        <p className="muted">{HELP.find((h) => h.id === help)?.about}</p>
      </fieldset>
      <fieldset>
        <legend>Time</legend>
        <div className="segmented time-controls">
          {[{ id: UNTIMED, label: 'Untimed' }, ...TIME_CONTROLS].map((t) => (
            <button key={t.id} className={timing === t.id ? 'active' : ''} onClick={() => setTiming(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="row">
        <button className="primary" onClick={() => void friend.challenge(color, timing, help)}>
          Post challenge
        </button>
      </div>
    </section>
  )
}

function Game({ friend, onReview, onFlip }: FriendPanelProps) {
  const view = friend.view!
  const [confirmResign, setConfirmResign] = useState(false)
  const opponent = friend.opponent ?? 'Your opponent'
  const over = view.status === 'over'
  const theirOffer = view.draw_offer !== null && view.draw_offer !== friend.you
  const yourTakeback = view.takeback_offer !== null && view.takeback_offer === friend.you
  const theirTakeback = view.takeback_offer !== null && view.takeback_offer !== friend.you
  const at = friend.viewing ?? friend.plies.length
  return (
    <section className="coach friend" aria-label={`Game against ${opponent}`}>
      <div className="coach-feed">
        <div className="bubble info">
          <p>
            You're playing {friend.you} against {opponent}: {timeLabel(view.time_control).toLowerCase()},{' '}
            {view.help === 'graded' ? 'graded' : 'unassisted'}.
          </p>
        </div>
        {over ? (
          <div className="bubble over">
            <p>{friendResult(view)}</p>
          </div>
        ) : (
          <div className={`bubble friend-status ${friend.myTurn ? 'latest' : ''}`}>
            <p>{friend.myTurn ? 'Your move.' : `${opponent}'s move.`}</p>
          </div>
        )}
        {!over && view.draw_offer === friend.you && (
          <p className="muted">You offered a draw. It stands until someone moves.</p>
        )}
        {!over && theirOffer && (
          <div className="bubble hint">
            <p>{opponent} offers a draw.</p>
            <div className="coach-actions">
              <button className="primary" onClick={() => void friend.draw('accept')}>
                Accept
              </button>
              <button onClick={() => void friend.draw('decline')}>Decline</button>
            </div>
          </div>
        )}
        {!over && yourTakeback && (
          <p className="muted">You asked to take your move back. It stands until {opponent} answers.</p>
        )}
        {!over && theirTakeback && (
          <div className="bubble hint">
            {/* They get their move back; if they're the one to move, your reply to it comes off with it. */}
            <p>
              {opponent} asks to take their last move back{friend.myTurn ? '' : ', and your reply with it'}.
            </p>
            <div className="coach-actions">
              <button className="primary" onClick={() => void friend.takeback('accept')}>
                Accept
              </button>
              <button onClick={() => void friend.takeback('decline')}>Decline</button>
            </div>
          </div>
        )}
        {friend.error && <p className="friend-error">{friend.error}</p>}
      </div>
      {over ? (
        <div className="coach-actions">
          {friend.plies.length > 0 && (
            <button className="primary" onClick={onReview} disabled={!friend.review}>
              {friend.review ? '📊 Game review' : 'Grading the moves…'}
            </button>
          )}
          <button onClick={() => void friend.leave()}>Back to the lobby</button>
        </div>
      ) : (
        <div className="controls">
          {confirmResign ? (
            <>
              <button className="primary" onClick={() => void friend.resign()}>
                Resign for good
              </button>
              <button onClick={() => setConfirmResign(false)}>Keep playing</button>
            </>
          ) : (
            <>
              <button onClick={() => setConfirmResign(true)} title="Give up this game">
                🏳 Resign
              </button>
              <button
                onClick={() => void friend.draw('offer')}
                disabled={view.draw_offer !== null}
                title={theirOffer ? 'Accept their offer' : 'Offer a draw'}
              >
                ½ Offer draw
              </button>
              <button
                onClick={() => void friend.takeback('offer')}
                disabled={!friend.moveToTakeBack || view.takeback_offer !== null}
                title={
                  theirTakeback
                    ? 'Answer their request first'
                    : friend.myTurn
                      ? 'Ask to take your last move back, and their reply to it'
                      : 'Ask to take your last move back'
                }
              >
                ↩ Take back
              </button>
            </>
          )}
          <button onClick={onFlip} title="Flip the board">
            ⇅ Flip
          </button>
        </div>
      )}
      <div className="move-nav" aria-label="Step through the game">
        <button onClick={() => friend.step(1)} disabled={friend.plies.length < 2 || friend.viewing === 1} title="First move">
          ⏮
        </button>
        <button onClick={() => friend.step(at - 1)} disabled={at <= 1} title="Previous move">
          ◀
        </button>
        <button onClick={() => friend.viewing !== null && friend.step(friend.viewing + 1)} disabled={friend.viewing === null} title="Next move">
          ▶
        </button>
        <button onClick={() => friend.step(null)} disabled={friend.viewing === null} title="Back to the game">
          ⏭
        </button>
      </div>
      <MoveList plies={friend.plies} showGrades={friend.gradesShown} current={at - 1} onSelect={(i) => friend.step(i + 1)} />
    </section>
  )
}
