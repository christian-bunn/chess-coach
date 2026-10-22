import { useEffect, useRef } from 'react'
import type { CoachConfig } from '../api'
import { GRADE_META } from '../grades'
import { moveLabel, type CoachMessage, type Phase } from '../useCoachGame'

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
}

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
}: CoachPanelProps) {
  const feed = useRef<HTMLDivElement>(null)
  // Follow new text only while the reader is at the bottom, so scrolling up to reread isn't interrupted.
  const following = useRef(true)
  useEffect(() => {
    const el = feed.current
    if (el && following.current) el.scrollTo({ top: el.scrollHeight })
  }, [messages, phase])

  return (
    <section className="coach" aria-label="Coach">
      <div
        className="coach-feed"
        ref={feed}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {STATUS[phase] && <p className="coach-status">{STATUS[phase]}</p>}
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
      <p className="coach-source">
        {coachAI?.via === 'claude-code' ? (
          <>Comments by Claude ({coachAI.model}) through Claude Code, on your Claude plan.</>
        ) : coachAI ? (
          <>Comments by Claude ({coachAI.model}) through the Anthropic API, billed to your API key.</>
        ) : (
          <>Built-in comments. Log in to Claude Code to have Claude explain each move (see README).</>
        )}
      </p>
    </section>
  )
}

function Message({ message }: { message: CoachMessage }) {
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
      <div className="bubble">
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
  return (
    <div className={`bubble ${message.kind}`}>
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
