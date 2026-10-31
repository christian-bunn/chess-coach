import type { ReactNode } from 'react'
import type { Classification, Eval } from './api'

/**
 * A thumb, drawn rather than typed: the emoji is multicoloured, and these badges are a white mark on a
 * coloured disc. It takes its colour from the badge and its size from the font, like the characters do.
 */
function ThumbsUp() {
  return (
    <svg viewBox="0 0 24 24" width="1.3em" height="1.3em" fill="currentColor" aria-hidden style={{ display: 'block' }}>
      {/* The wrist, held apart from the hand by the gap between them. */}
      <rect x="2" y="11" width="5" height="10.5" rx="1.2" />
      {/* The folded fingers. */}
      <rect x="8.6" y="11" width="12.8" height="10.5" rx="2.6" />
      {/* The thumb, a capsule leaning out of the top of the hand. */}
      <path d="M12.8 10.2 11.9 5" stroke="currentColor" strokeWidth="5.4" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export const GRADE_META: Record<Classification, { label: string; symbol: ReactNode; color: string }> = {
  great: { label: 'Great move', symbol: '!', color: '#4a9fd8' },
  best: { label: 'Best move', symbol: '★', color: '#81b64c' },
  excellent: { label: 'Excellent', symbol: <ThumbsUp />, color: '#96bc4b' },
  good: { label: 'Good', symbol: '✓', color: '#77915f' },
  book: { label: 'Book', symbol: '📖', color: '#a88865' },
  forced: { label: 'Forced', symbol: '□', color: '#97948f' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', color: '#f0c03a' },
  mistake: { label: 'Mistake', symbol: '?', color: '#ffa459' },
  miss: { label: 'Missed win', symbol: '✗', color: '#ee6b55' },
  blunder: { label: 'Blunder', symbol: '??', color: '#ca3431' },
}

export const GOOD_GRADES: ReadonlySet<Classification> = new Set(['great', 'best', 'excellent', 'good', 'book'])

/** "+1.3", "-0.4", "M3", "-M2", or "1-0" / "0-1" once the game is over. */
export function formatEval(ev: Eval): string {
  if (ev.mate === 0) return ev.white_win >= 50 ? '1-0' : '0-1'
  if (ev.mate !== null) return `${ev.mate > 0 ? '' : '-'}M${Math.abs(ev.mate)}`
  const pawns = (ev.cp ?? 0) / 100
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`
}
