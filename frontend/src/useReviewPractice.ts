import type { Chess } from 'chess.js'
import { useRef, useState } from 'react'
import { api, type Classification, type MoveGrade } from './api'
import { GOOD_GRADES, GRADE_META } from './grades'
import { buildGame, moveLabel, type ReviewSnapshot } from './useCoachGame'

/**
 * thinking: waiting for the student's move
 * grading:  their move is being checked
 * right:    a good move or better
 * wrong:    not good enough: they can try again or see the best move
 * shown:    the best move is on the board
 * error:    the engine couldn't be reached
 */
export type PracticeStatus = 'thinking' | 'grading' | 'right' | 'wrong' | 'shown' | 'error'

export interface Practice {
  /** The move being replayed (1 = White's first). */
  ply: number
  status: PracticeStatus
  /** The move the student just tried (UCI), and its grade once checked. */
  tried: string | null
  attempt: MoveGrade | null
}

/** What the board shows while practising. */
export interface PracticeBoard {
  game: Chess
  interactive: boolean
  lastMove: { from: string; to: string } | null
  best: { from: string; to: string } | null
  badge: { square: string; classification: Classification } | null
  caption: string
}

/**
 * Replaying a move from the game review: the board goes back to the position before it, and the student
 * looks for something better. Their tries are graded like any move, but the game itself isn't touched.
 */
export function useReviewPractice(review: ReviewSnapshot | null) {
  const [practice, setPractice] = useState<Practice | null>(null)
  const pending = useRef<AbortController | null>(null)

  const cancel = () => {
    pending.current?.abort()
    pending.current = null
  }
  const reset = (status: PracticeStatus) => {
    cancel()
    setPractice((p) => p && { ...p, status, tried: null, attempt: null })
  }

  const start = (ply: number) => {
    cancel()
    setPractice({ ply, status: 'thinking', tried: null, attempt: null })
  }
  const stop = () => {
    cancel()
    setPractice(null)
  }

  const play = async (uci: string) => {
    if (!review || practice?.status !== 'thinking') return
    const { ply } = practice
    const controller = new AbortController()
    pending.current = controller
    setPractice({ ply, status: 'grading', tried: uci, attempt: null })
    try {
      const moves = review.plies.slice(0, ply - 1).map((p) => p.uci)
      const grade = await api.grade([...moves, uci], controller.signal)
      if (controller.signal.aborted) return
      setPractice({ ply, status: GOOD_GRADES.has(grade.classification) ? 'right' : 'wrong', tried: uci, attempt: grade })
    } catch {
      if (!controller.signal.aborted) setPractice({ ply, status: 'error', tried: null, attempt: null })
    }
  }

  let board: PracticeBoard | null = null
  if (practice && review) {
    const original = review.plies[practice.ply - 1]
    const game = buildGame(review.plies.slice(0, practice.ply - 1))
    const { tried, attempt, status } = practice
    if (tried) game.move({ from: tried.slice(0, 2), to: tried.slice(2, 4), promotion: tried[4] })
    const best = original.grade?.best_move
    board = {
      game,
      interactive: status === 'thinking',
      lastMove: tried ? { from: tried.slice(0, 2), to: tried.slice(2, 4) } : null,
      best: status === 'shown' && best ? { from: best.slice(0, 2), to: best.slice(2, 4) } : null,
      badge: attempt ? { square: attempt.uci.slice(2, 4), classification: attempt.classification } : null,
      caption:
        status === 'shown'
          ? `The best move: ${moveLabel(practice.ply - 1, original.grade?.best_san ?? '')}`
          : attempt
            ? `${moveLabel(practice.ply - 1, attempt.san)} · ${GRADE_META[attempt.classification].label}`
            : `You played ${moveLabel(practice.ply - 1, original.san)}. Find something better.`,
    }
  }

  return {
    practice,
    board,
    start,
    stop,
    play,
    tryAgain: () => reset('thinking'),
    showBest: () => reset('shown'),
  }
}
