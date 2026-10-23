import type { Classification, MoveGrade } from './api'
import { GOOD_GRADES, GRADE_META } from './grades'
import type { BoardPreview } from './moveRefs'
import { buildGame, moveLabel, type ReviewSnapshot } from './useCoachGame'

/** The grades the review counts, best first. */
export const REVIEW_GRADES: Classification[] = [
  'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder',
]

/** The opening the game reached (its deepest named position), e.g. { name: "Italian Game", eco: "C50" }. */
export function openingOf(plies: { grade: MoveGrade | null }[]): { name: string; eco: string | null } | null {
  const grade = plies.findLast((p) => p.grade?.opening)?.grade
  return grade?.opening ? { name: grade.opening, eco: grade.eco } : null
}

// The student's moves worth going back to (plus any move that missed a mate).
const KEY_GRADES: ReadonlySet<Classification> = new Set(['great', 'mistake', 'miss', 'blunder'])

/** How accurately one move was played, 0-100, from how much of the mover's winning chance it gave away (Lichess's formula). */
export function moveAccuracy(winLoss: number): number {
  return Math.min(100, Math.max(0, 103.1668 * Math.exp(-0.04354 * winLoss) - 3.1669))
}

/**
 * Accuracy over a game: the average of the plain mean and the harmonic mean of the moves' accuracies, so a
 * few bad moves weigh more than in a plain average (Lichess does something similar). Forced moves don't count.
 */
export function accuracy(grades: MoveGrade[]): number | null {
  const scores = grades.filter((g) => g.classification !== 'forced').map((g) => moveAccuracy(g.win_loss))
  if (scores.length === 0) return null
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const harmonic = scores.length / scores.reduce((a, b) => a + 1 / Math.max(b, 1), 0)
  return (mean + harmonic) / 2
}

/** The grades of the student's moves (`mine`) or the opponent's. */
export function sideGrades(review: ReviewSnapshot, mine: boolean): MoveGrade[] {
  return review.plies.flatMap((p) => (p.grade && (p.grade.color === review.userColor) === mine ? [p.grade] : []))
}

export function countGrades(grades: MoveGrade[]): Record<Classification, number> {
  const counts = Object.fromEntries(Object.keys(GRADE_META).map((c) => [c, 0])) as Record<Classification, number>
  for (const g of grades) counts[g.classification]++
  return counts
}

/** The student's moves worth looking at again: great moves, mistakes, misses, blunders and missed mates. */
export function keyMoments(review: ReviewSnapshot): MoveGrade[] {
  return sideGrades(review, true).filter((g) => KEY_GRADES.has(g.classification) || g.missed_mate_in !== null)
}

/** Whether the engine had a clearly better move than `grade`'s. */
export function hadBetter(grade: MoveGrade): boolean {
  return !GOOD_GRADES.has(grade.classification) && grade.classification !== 'forced' && !!grade.best_move && grade.best_move !== grade.uci
}

/**
 * The board for move `ply` (1 = White's first) of the reviewed game: the position after it, with its grade on
 * the piece that moved. With `withBest`, the position before it instead, with the move and the engine's better
 * move drawn as arrows.
 */
export function previewMove(review: ReviewSnapshot, ply: number, withBest = false): BoardPreview {
  const played = review.plies[ply - 1]
  const grade = played.grade
  const best = withBest && grade && hadBetter(grade) ? grade : null
  return {
    fen: buildGame(review.plies.slice(0, best ? ply - 1 : ply)).fen(),
    from: played.uci.slice(0, 2),
    to: played.uci.slice(2, 4),
    played: !best,
    badge: !best ? grade?.classification : undefined,
    label:
      moveLabel(ply - 1, played.san) +
      (grade ? ` · ${GRADE_META[grade.classification].label}` : '') +
      (best ? ` · better was ${best.best_san}` : ''),
    best: best?.best_move ? { from: best.best_move.slice(0, 2), to: best.best_move.slice(2, 4) } : undefined,
  }
}

/** The student's winning chances (0-100) after each ply, starting from the initial position. */
export function winningChances(review: ReviewSnapshot): number[] {
  const chances: number[] = []
  let last = 50
  for (let i = 0; i <= review.plies.length; i++) {
    const ev = review.evals[i]
    if (ev) last = review.userColor === 'white' ? ev.white_win : 100 - ev.white_win
    chances.push(last)
  }
  return chances
}
