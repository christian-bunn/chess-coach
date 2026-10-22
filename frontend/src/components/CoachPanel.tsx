import { useLayoutEffect, useRef, useState } from 'react'
import type { CoachConfig } from '../api'
import { GRADE_META } from '../grades'
import { HINT_LEVELS, moveLabel, type CoachMessage, type Phase } from '../useCoachGame'

interface CoachPanelProps {
  messages: CoachMessage[]
  phase: Phase
  canShowBest: boolean
  /** Who writes the comments, or null when the built-in templates are used. */
  coachAI: CoachConfig | null
  onTryAgain: () => void
  onShowBest: () => void
  onContinue: () => void
  onRetryFailed: () => void
  canHint: boolean
  /** Hint levels already used at this position. */
  hintsUsed: number
  onHint: () => void
  onAsk: (question: string) => void
}

const HINT_LABELS = ['Hint', 'Bigger hint', 'Show move']

const STATUS: Partial<Record<Phase, string>> = {
  grading: 'Looking at your move…',
  bot: 'Opponent is thinking…',
}

export function CoachPanel({
  messages,
  phase,
  canShowBest,
  coachAI,
  onTryAgain,
  onShowBest,
  onContinue,
  onRetryFailed,
  canHint,
  hintsUsed,
  onHint,
  onAsk,
}: CoachPanelProps) {
  const [question, setQuestion] = useState('')
  const feed = useRef<HTMLDivElement>(null)
  // Follow new text only while the reader is at the bottom, so scrolling up to reread isn't interrupted.
  // While they're scrolled up, a "Latest" button shows that something new has arrived.
  const following = useRef(true)
  const [unseen, setUnseen] = useState(false)
  // A layout effect, so the scroll happens right after the new content is laid out (no flicker).
  useLayoutEffect(() => {
    const el = feed.current
    if (!el) return
    if (following.current) el.scrollTop = el.scrollHeight
    else setUnseen(true)
  }, [messages, phase])
  const jumpToLatest = () => {
    if (feed.current) feed.current.scrollTop = feed.current.scrollHeight
    following.current = true
    setUnseen(false)
  }
  const latestId = messages.findLast((m) => m.kind !== 'question')?.id

  return (
    <section className="coach" aria-label="Coach">
      <div className="coach-feed-wrap">
        <div
          className="coach-feed"
          ref={feed}
          aria-live="polite"
          onScroll={(e) => {
            const el = e.currentTarget
            following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
            if (following.current) setUnseen(false)
          }}
        >
          {messages.map((m) => (
            <Message key={m.id} message={m} latest={m.id === latestId} />
          ))}
          {STATUS[phase] && <p className="coach-status">{STATUS[phase]}</p>}
        </div>
        {unseen && (
          <button className="jump-latest" onClick={jumpToLatest}>
            ↓ Latest
          </button>
        )}
      </div>
      {phase === 'decision' && (
        <div className="coach-actions">
          <button className="primary" onClick={onTryAgain}>
            Try again
          </button>
          {canShowBest && <button onClick={onShowBest}>Show me</button>}
          <button onClick={onContinue}>Keep my move</button>
        </div>
      )}
      {phase === 'error' && (
        <div className="coach-actions">
          <button className="primary" onClick={onRetryFailed}>
            Retry
          </button>
        </div>
      )}
      <div className="hint-row">
        <button
          type="button"
          onClick={onHint}
          disabled={!canHint}
          title={hintsUsed >= HINT_LEVELS ? 'No more hints for this move' : 'Get a hint for your move'}
        >
          💡 {HINT_LABELS[Math.min(hintsUsed, HINT_LEVELS - 1)]}
        </button>
        {hintsUsed > 0 && (
          <span className="muted">
            {hintsUsed}/{HINT_LEVELS} hints used
          </span>
        )}
      </div>
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault()
          if (!question.trim()) return
          onAsk(question)
          setQuestion('')
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          disabled={!coachAI}
          placeholder={coachAI ? 'Ask the coach… e.g. "what about Nf5?"' : 'Questions need Claude (see README)'}
          aria-label="Ask the coach a question"
        />
        <button type="submit" disabled={!coachAI || !question.trim()}>
          Ask
        </button>
      </form>
    </section>
  )
}

/** `latest`: the newest coach message, highlighted so it's easy to find again. */
function Message({ message, latest }: { message: CoachMessage; latest: boolean }) {
  const grade = message.grade
  const body = (
    <p>
      {message.prefix}
      {message.text}
      {message.explaining && <span className="typing" aria-label="Coach is writing" />}
    </p>
  )
  if (message.kind === 'grade' && grade) {
    const meta = GRADE_META[grade.classification]
    return (
      <div className={`bubble ${latest ? 'latest' : ''}`}>
        <div className="bubble-head">
          <span className="badge" style={{ background: meta.color }}>
            {meta.symbol}
          </span>
          <strong>{moveLabel(grade.ply - 1, grade.san)}</strong>
          <span style={{ color: meta.color }}>{meta.label}</span>
        </div>
        {body}
      </div>
    )
  }
  if (message.kind === 'question') {
    return (
      <div className="bubble question">
        <p>{message.text}</p>
      </div>
    )
  }
  return (
    <div className={`bubble ${message.kind} ${latest ? 'latest' : ''}`}>
      {message.kind === 'hint' && (
        <div className="bubble-head">
          <span aria-hidden>💡</span>
          <strong>
            Hint {message.hintLevel}/{HINT_LEVELS}
          </strong>
        </div>
      )}
      {message.kind === 'opponent' && grade && (
        <div className="bubble-head">
          <span className="badge" style={{ background: GRADE_META[grade.classification].color }}>
            {GRADE_META[grade.classification].symbol}
          </span>
          <strong>{moveLabel(grade.ply - 1, grade.san)}</strong>
          <span className="muted">opponent</span>
        </div>
      )}
      {body}
    </div>
  )
}
