import type { Eval } from '../api'
import { formatEval } from '../grades'

export function EvalBar({ evaluation, orientation }: { evaluation: Eval | null; orientation: 'white' | 'black' }) {
  const whiteWin = evaluation?.white_win ?? 50
  const whiteAhead = whiteWin >= 50
  return (
    <div className={`eval-bar ${orientation === 'black' ? 'flipped' : ''}`} aria-label="Evaluation">
      <div className="eval-white" style={{ height: `${whiteWin}%` }} />
      {evaluation && (
        <span className={`eval-label ${whiteAhead ? 'on-white' : 'on-black'}`}>{formatEval(evaluation)}</span>
      )}
    </div>
  )
}
