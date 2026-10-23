import { Chess } from 'chess.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Classification, type MoveGrade, type Puzzle, type PuzzleSummary } from './api'

/**
 * thinking: waiting for the student's move
 * grading:  their move is being checked
 * right:    found it
 * wrong:    not it: they can try again or see the solution
 * shown:    the solution is on the board
 * error:    the engine couldn't be reached
 */
export type PuzzleStatus = 'thinking' | 'grading' | 'right' | 'wrong' | 'shown' | 'error'

/** What the board shows for a puzzle. */
export interface PuzzleBoard {
  game: Chess
  interactive: boolean
  lastMove: { from: string; to: string } | null
  solution: { from: string; to: string } | null
  badge: { square: string; classification: Classification } | null
}

function gameFrom(moves: string[]): Chess {
  const game = new Chess()
  for (const uci of moves) game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  return game
}

/**
 * "Learn from your mistakes": puzzles from the student's own games, with spaced repetition. Only the first
 * answer to a puzzle counts for its schedule: found at the first try, it comes back later than last time;
 * a wrong first try, or asking for the solution, brings it back tomorrow.
 */
export function usePuzzles() {
  const [summary, setSummary] = useState<PuzzleSummary | null>(null)
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  const [status, setStatus] = useState<PuzzleStatus>('thinking')
  const [tried, setTried] = useState<string | null>(null)
  const [attempt, setAttempt] = useState<MoveGrade | null>(null)
  // The puzzle as rescheduled once its result is recorded (null until then).
  const [scheduled, setScheduled] = useState<Puzzle | null>(null)
  const [loading, setLoading] = useState(false)
  const recorded = useRef(false)
  const pending = useRef<AbortController | null>(null)

  const refresh = useCallback(() => {
    api.puzzles.summary().then(setSummary, () => {})
  }, [])
  useEffect(refresh, [refresh])

  const show = (next: Puzzle | null) => {
    pending.current?.abort()
    recorded.current = false
    setPuzzle(next)
    setStatus('thinking')
    setTried(null)
    setAttempt(null)
    setScheduled(null)
  }

  /** Load the next due puzzle (with `early`, the soonest one even if it isn't due yet). */
  const load = async (early = false) => {
    setLoading(true)
    try {
      show(await api.puzzles.next(early))
    } catch {
      show(null)
    } finally {
      setLoading(false)
      refresh()
    }
  }

  const record = (solved: boolean) => {
    if (!puzzle || recorded.current) return
    recorded.current = true
    api.puzzles.result(puzzle.id, solved).then((p) => {
      setScheduled(p)
      refresh()
    }, () => {})
  }

  const play = async (uci: string) => {
    if (!puzzle || status !== 'thinking') return
    const controller = new AbortController()
    pending.current = controller
    setTried(uci)
    setStatus('grading')
    try {
      const result = await api.puzzles.attempt(puzzle.id, uci, controller.signal)
      if (controller.signal.aborted) return
      setAttempt(result.grade)
      setStatus(result.correct ? 'right' : 'wrong')
      record(result.correct)
    } catch {
      if (!controller.signal.aborted) {
        setTried(null)
        setStatus('error')
      }
    }
  }

  const tryAgain = () => {
    setTried(null)
    setAttempt(null)
    setStatus('thinking')
  }

  const showSolution = () => {
    pending.current?.abort()
    setTried(null)
    setAttempt(null)
    setStatus('shown')
    record(false)
  }

  const remove = async () => {
    if (!puzzle) return
    await api.puzzles.remove(puzzle.id).catch(() => {})
    await load()
  }

  const board = useMemo((): PuzzleBoard | null => {
    if (!puzzle) return null
    const game = gameFrom(puzzle.moves)
    const previous = puzzle.moves.at(-1)
    if (tried) game.move({ from: tried.slice(0, 2), to: tried.slice(2, 4), promotion: tried[4] })
    const last = tried ?? previous
    return {
      game,
      interactive: status === 'thinking',
      lastMove: last ? { from: last.slice(0, 2), to: last.slice(2, 4) } : null,
      solution: status === 'shown' ? { from: puzzle.best.slice(0, 2), to: puzzle.best.slice(2, 4) } : null,
      badge: attempt ? { square: attempt.uci.slice(2, 4), classification: attempt.classification } : null,
    }
  }, [puzzle, tried, attempt, status])

  return { summary, puzzle, status, attempt, scheduled, loading, board, refresh, load, play, tryAgain, showSolution, remove }
}
