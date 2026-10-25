import { Chess } from 'chess.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Eval, type OpeningLine, type OpeningPosition, type PracticeStep } from './api'

export type OpeningSide = 'white' | 'black'

/**
 * checking: asking the backend what comes next
 * thinking: the student's move
 * opponent: the other side's book move is being played
 * wrong:    the student's move wasn't one of this opening's book moves (they try again)
 * done:     the opening's lines end here
 * error:    the backend couldn't be reached
 */
export type PracticeStatus = 'checking' | 'thinking' | 'opponent' | 'wrong' | 'done' | 'error'

export interface OpeningPractice {
  side: OpeningSide
  moves: string[]
  status: PracticeStatus
  /** The book moves the student can play now, most lines first (shown on request). */
  options: PracticeStep['moves']
  shown: boolean
  /** Positions where the student's first try wasn't a book move. */
  mistakes: number
  /** The student's last try that wasn't a book move, in SAN. */
  wrong: string | null
}

/** What the board shows on the Openings page. */
export interface OpeningBoard {
  game: Chess
  interactive: boolean
  userColor: 'w' | 'b'
  orientation: OpeningSide
  lastMove: { from: string; to: string } | null
  /** A book move being pointed at in the list, or the answer when practising. */
  arrow: { from: string; to: string } | null
}

export function gameFrom(moves: string[]): Chess {
  const game = new Chess()
  for (const uci of moves) game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  return game
}

/** The moves in SAN. */
export function sans(moves: string[]): string[] {
  const game = new Chess()
  return moves.map((uci) => game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san)
}

/** Who chooses an opening: whoever plays its last move (1.e4 c5, the Sicilian, is Black's choice). */
export function sideOf(line: OpeningLine): OpeningSide {
  return line.moves.length % 2 === 1 ? 'white' : 'black'
}

const sideToMove = (moves: string[]): OpeningSide => (moves.length % 2 === 0 ? 'white' : 'black')
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** One of the book moves at random, the more lines through it the likelier, so main lines come up most. */
function pick(moves: PracticeStep['moves']): string {
  let roll = Math.random() * moves.reduce((sum, m) => sum + m.lines, 0)
  for (const m of moves) {
    roll -= m.lines
    if (roll < 0) return m.uci
  }
  return moves[0].uci
}

/** The Openings page: choosing an opening, exploring its book moves, and practising it from memory. */
export function useOpenings() {
  const [featured, setFeatured] = useState<{ group: string; side: OpeningSide; lines: OpeningLine[] }[] | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<OpeningLine[] | null>(null)
  const [line, setLine] = useState<OpeningLine | null>(null)
  // Exploring: the moves on the path, and how many of them are on the board (stepping back keeps the rest).
  const [path, setPath] = useState<string[]>([])
  const [at, setAt] = useState(0)
  const [position, setPosition] = useState<OpeningPosition | null>(null)
  const [evaluation, setEvaluation] = useState<Eval | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [practice, setPractice] = useState<OpeningPractice | null>(null)
  // Bumped when a practice run starts or stops, so a stopped run's late replies are dropped.
  const run = useRef(0)

  useEffect(() => {
    api.openings.featured().then(setFeatured, () => setFeatured([]))
  }, [])

  // Search as you type.
  useEffect(() => {
    if (!query.trim()) {
      setResults(null)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => api.openings.search(query, controller.signal).then(setResults, () => {}), 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const current = useMemo(() => path.slice(0, at), [path, at])
  const practising = practice !== null

  // While exploring: what the position is, its book moves, and the engine's view of it.
  useEffect(() => {
    if (!line || practising) return
    const controller = new AbortController()
    setPosition(null)
    setEvaluation(null)
    api.openings.explore(current, controller.signal).then(setPosition, () => {})
    api.analyze(current, controller.signal).then((a) => setEvaluation(a.eval), () => {})
    return () => controller.abort()
  }, [line, current, practising])

  const choose = (next: OpeningLine) => {
    run.current++
    setLine(next)
    setPath(next.moves)
    setAt(next.moves.length)
    setPractice(null)
    setHover(null)
  }

  const close = () => {
    run.current++
    setLine(null)
    setPractice(null)
    setPath([])
    setAt(0)
  }

  const step = (to: number) => {
    setHover(null)
    setAt(Math.max(0, Math.min(path.length, to)))
  }

  /** Play a move while exploring (a book move or not). If it's the next move on the path, keep the rest. */
  const explore = (uci: string) => {
    setHover(null)
    if (path[at] === uci) {
      setAt(at + 1)
      return
    }
    setPath([...path.slice(0, at), uci])
    setAt(at + 1)
  }

  const advance = async (id: number, side: OpeningSide, moves: string[], mistakes: number) => {
    if (!line) return
    let next: PracticeStep
    try {
      next = await api.openings.practice(line.moves, moves)
    } catch {
      if (id === run.current) setPractice((p) => p && { ...p, status: 'error' })
      return
    }
    if (id !== run.current) return
    const base = { side, moves, shown: false, mistakes, wrong: null }
    if (!next.on_line || next.moves.length === 0) {
      setPractice({ ...base, status: 'done', options: [] })
    } else if (sideToMove(moves) === side) {
      setPractice({ ...base, status: 'thinking', options: next.moves })
    } else {
      // The opponent plays one of its book moves, after a moment so it can be followed.
      setPractice({ ...base, status: 'opponent', options: [] })
      await wait(450)
      if (id !== run.current) return
      const played = [...moves, pick(next.moves)]
      setPractice({ ...base, moves: played, status: 'checking', options: [] })
      void advance(id, side, played, mistakes)
    }
  }

  /** Practise the chosen opening from the start, playing `side`. */
  const startPractice = (side: OpeningSide) => {
    const id = ++run.current
    setHover(null)
    setPractice({ side, moves: [], status: 'checking', options: [], shown: false, mistakes: 0, wrong: null })
    void advance(id, side, [], 0)
  }

  const practiceMove = (uci: string) => {
    const p = practice
    if (!p || (p.status !== 'thinking' && p.status !== 'wrong')) return
    if (p.options.some((o) => o.uci === uci)) {
      const played = [...p.moves, uci]
      setPractice({ ...p, moves: played, status: 'checking', wrong: null, shown: false })
      void advance(run.current, p.side, played, p.mistakes)
      return
    }
    const san = gameFrom(p.moves).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
    // A position counts once as a mistake, however many tries it takes.
    setPractice({ ...p, status: 'wrong', wrong: san, mistakes: p.status === 'wrong' ? p.mistakes : p.mistakes + 1 })
  }

  const showAnswer = () => setPractice((p) => p && { ...p, shown: true })

  const stopPractice = () => {
    run.current++
    setPractice(null)
  }

  /** Leave practice and explore from where it got to. */
  const exploreFromPractice = () => {
    if (!practice) return
    const moves = practice.moves
    run.current++
    setPractice(null)
    setPath(moves)
    setAt(moves.length)
  }

  const board = useMemo((): OpeningBoard | null => {
    if (!line) return null
    if (practice) {
      const last = practice.moves.at(-1)
      const answer = practice.shown ? practice.options[0]?.uci : undefined
      return {
        game: gameFrom(practice.moves),
        interactive: practice.status === 'thinking' || practice.status === 'wrong',
        userColor: practice.side === 'white' ? 'w' : 'b',
        orientation: practice.side,
        lastMove: last ? { from: last.slice(0, 2), to: last.slice(2, 4) } : null,
        arrow: answer ? { from: answer.slice(0, 2), to: answer.slice(2, 4) } : null,
      }
    }
    const game = gameFrom(current)
    const last = current.at(-1)
    return {
      game,
      interactive: true,
      userColor: game.turn(),
      orientation: sideOf(line),
      lastMove: last ? { from: last.slice(0, 2), to: last.slice(2, 4) } : null,
      arrow: hover ? { from: hover.slice(0, 2), to: hover.slice(2, 4) } : null,
    }
  }, [line, practice, current, hover])

  return {
    featured, query, setQuery, results, line, choose, close,
    path, at, current, position, evaluation, step, explore, setHover,
    practice, startPractice, practiceMove, showAnswer, stopPractice, exploreFromPractice,
    board,
  }
}
