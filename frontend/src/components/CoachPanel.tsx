import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { GRADE_META } from '../grades'
import { findMoveRefs, type MoveRef } from '../moveRefs'
import { moveLabel, type CoachMessage, type Phase } from '../useCoachGame'

interface CoachPanelProps {
  messages: CoachMessage[]
  phase: Phase
  canShowBest: boolean
  onTryAgain: () => void
  onShowBest: () => void
  onContinue: () => void
  onRetryFailed: () => void
  /** 💡 Hint: the idea behind the best move. */
  canIdea: boolean
  onIdea: () => void
  /** ♟ Show piece, then ➜ Show move. `pieceStep`: 0 nothing shown yet, 1 the piece is shown, 2 both. */
  canPiece: boolean
  pieceStep: number
  onPiece: () => void
  /** Open the game review: from the hint row at any time, and offered when the game is over. */
  canReview: boolean
  onReview: () => void
  /** Show a move mentioned in a message on the board (null: back to the game). */
  onPreview: (move: MoveRef | null) => void
}

const HINT_TITLES: Record<number, string> = { 1: 'Hint', 2: 'Which piece', 3: 'The move' }

const STATUS: Partial<Record<Phase, string>> = {
  grading: 'Looking at your move…',
  bot: 'Opponent is thinking…',
}

export function CoachPanel({
  messages,
  phase,
  canShowBest,
  onTryAgain,
  onShowBest,
  onContinue,
  onRetryFailed,
  canIdea,
  onIdea,
  canPiece,
  pieceStep,
  onPiece,
  canReview,
  onReview,
  onPreview,
}: CoachPanelProps) {
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
  const latestId = messages.at(-1)?.id

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
            <Message key={m.id} message={m} latest={m.id === latestId} onPreview={onPreview} />
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
      {phase === 'over' && (
        <div className="coach-actions">
          <button className="primary" onClick={onReview}>
            📊 Game review
          </button>
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
        <button type="button" onClick={onIdea} disabled={!canIdea} title="A nudge toward the idea, without giving the move">
          💡 Hint
        </button>
        <button
          type="button"
          onClick={onPiece}
          disabled={!canPiece}
          title={pieceStep === 0 ? 'Highlight the piece to move' : 'Show where the piece goes'}
        >
          {pieceStep === 0 ? '♟ Show piece' : '➜ Show move'}
        </button>
        <button type="button" className="review-button" onClick={onReview} disabled={!canReview} title="Accuracy, grades and key moments so far">
          📊 Review
        </button>
      </div>
    </section>
  )
}

/** Message text with the moves it mentions as links: pointing at one shows it on the board. */
function MessageText({ text, context, onPreview }: { text: string; context?: string[]; onPreview: CoachPanelProps['onPreview'] }) {
  const segments = useMemo(() => (context ? findMoveRefs(text, context) : [text]), [text, context])
  return (
    <>
      {segments.map((segment, i) =>
        typeof segment === 'string' ? (
          segment
        ) : (
          <button
            key={i}
            type="button"
            className="move-ref"
            title={segment.label}
            onMouseEnter={() => onPreview(segment)}
            onMouseLeave={() => onPreview(null)}
            onFocus={() => onPreview(segment)}
            onBlur={() => onPreview(null)}
            onClick={() => onPreview(segment)}
          >
            {segment.text}
          </button>
        ),
      )}
    </>
  )
}

/** `latest`: the newest coach message, highlighted so it's easy to find again. */
function Message({ message, latest, onPreview }: { message: CoachMessage; latest: boolean; onPreview: CoachPanelProps['onPreview'] }) {
  const grade = message.grade
  const body = (
    <p>
      {message.prefix}
      <MessageText text={message.text} context={message.context} onPreview={onPreview} />
      {message.loading && <span className="typing" aria-label="Coach is thinking" />}
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
  return (
    <div className={`bubble ${message.kind} ${latest ? 'latest' : ''}`}>
      {message.kind === 'hint' && (
        <div className="bubble-head">
          <span aria-hidden>{message.hintLevel === 1 ? '💡' : message.hintLevel === 2 ? '♟' : '➜'}</span>
          <strong>{HINT_TITLES[message.hintLevel ?? 1]}</strong>
        </div>
      )}
      {message.kind === 'guide' && (
        <div className="bubble-head">
          {grade ? (
            <>
              <span className="badge" style={{ background: GRADE_META[grade.classification].color }}>
                {GRADE_META[grade.classification].symbol}
              </span>
              <strong>{moveLabel(grade.ply - 1, grade.san)}</strong>
              <span className="muted">opponent · your move</span>
            </>
          ) : (
            <strong>Your move</strong>
          )}
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
