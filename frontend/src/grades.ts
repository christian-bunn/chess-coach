import type { Classification, Eval } from './api'

export const GRADE_META: Record<Classification, { label: string; symbol: string; color: string }> = {
  great: { label: 'Great move', symbol: '!', color: '#4a9fd8' },
  best: { label: 'Best move', symbol: '★', color: '#81b64c' },
  excellent: { label: 'Excellent', symbol: '✓', color: '#96bc4b' },
  good: { label: 'Good', symbol: '✓', color: '#77915f' },
  forced: { label: 'Forced', symbol: '□', color: '#97948f' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', color: '#f0c03a' },
  mistake: { label: 'Mistake', symbol: '?', color: '#ffa459' },
  miss: { label: 'Missed win', symbol: '✗', color: '#ee6b55' },
  blunder: { label: 'Blunder', symbol: '??', color: '#ca3431' },
}

export const GOOD_GRADES: ReadonlySet<Classification> = new Set(['great', 'best', 'excellent', 'good'])

/** "+1.3", "-0.4", "M3", "-M2", or "1-0" / "0-1" once the game is over. */
export function formatEval(ev: Eval): string {
  if (ev.mate === 0) return ev.white_win >= 50 ? '1-0' : '0-1'
  if (ev.mate !== null) return `${ev.mate > 0 ? '' : '-'}M${Math.abs(ev.mate)}`
  const pawns = (ev.cp ?? 0) / 100
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`
}
