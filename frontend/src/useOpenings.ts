import { Chess } from 'chess.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Eval, type OpeningLine, type OpeningPosition, type PracticeStep, type Repertoire, type RepertoireEntry } from './api'

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
  /** The opening being practised (UCI, from the start). */
  target: string[]
  side: OpeningSide
  /** The repertoire entry this run reviews, if the opening is in the repertoire for this side. */
  entryId: string | null
  /** Once the run is complete and recorded: the entry as rescheduled, and whether the run counted (it was due). */
  review: { entry: RepertoireEntry; counted: boolean } | null
  moves: string[]
  status: PracticeStatus
  /** The book moves the student can play now, most lines first (shown on request). */
  options: PracticeStep['moves']
  shown: boolean
  /** Positions where the student's first try wasn't a book move, or they asked to be shown it. */
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

/** "1. e4 e5 2. Nf3" from SAN moves, numbered from the start. */
export function numbered(moves: string[]): string {
  return moves.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(' ')
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
  const [repertoire, setRepertoire] = useState<Repertoire | null>(null)
  // Bumped when a practice run starts or stops, so a stopped run's late replies are dropped.
  const run = useRef(0)

  const refreshRepertoire = () => {
    api.repertoire.list().then(setRepertoire, () => {})
  }
  useEffect(() => {
    api.openings.featured().then(setFeatured, () => setFeatured([]))
    refreshRepertoire()
  }, [])

  /** The repertoire entry for an opening line played as `side`, if there is one. */
  const entryFor = (moves: string[], side: OpeningSide) =>
    repertoire?.entries.find((e) => e.side === side && e.moves.join(' ') === moves.join(' ')) ?? null

  const addToRepertoire = async (side: OpeningSide) => {
    if (!line) return
    await api.repertoire.add({ name: line.name, eco: line.eco, moves: line.moves, side }).catch(() => {})
    refreshRepertoire()
  }

  const removeFromRepertoire = async (id: string) => {
    await api.repertoire.remove(id).catch(() => {})
    refreshRepertoire()
  }

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

  type Run = Pick<OpeningPractice, 'target' | 'side' | 'entryId'>

  const advance = async (id: number, of: Run, moves: string[], mistakes: number) => {
    let next: PracticeStep
    try {
      next = await api.openings.practice(of.target, moves)
    } catch {
      if (id === run.current) setPractice((p) => p && { ...p, status: 'error' })
      return
    }
    if (id !== run.current) return
    const base = { ...of, review: null, moves, shown: false, mistakes, wrong: null }
    if (!next.on_line || next.moves.length === 0) {
      setPractice({ ...base, status: 'done', options: [] })
      if (of.entryId) {
        // A completed run reviews the opening (if it was due), which sets when it comes back.
        const review = await api.repertoire.review(of.entryId, mistakes).catch(() => null)
        if (review && id === run.current) setPractice((p) => p && { ...p, review })
        refreshRepertoire()
      }
    } else if (sideToMove(moves) === of.side) {
      setPractice({ ...base, status: 'thinking', options: next.moves })
    } else {
      // The opponent plays one of its book moves, after a moment so it can be followed.
      setPractice({ ...base, status: 'opponent', options: [] })
      await wait(450)
      if (id !== run.current) return
      const played = [...moves, pick(next.moves)]
      setPractice({ ...base, moves: played, status: 'checking', options: [] })
      void advance(id, of, played, mistakes)
    }
  }

  /** Practise an opening from the start (the chosen one by default), playing `side`. */
  const startPractice = (side: OpeningSide, target: string[] | undefined = line?.moves) => {
    if (!target) return
    const id = ++run.current
    const of: Run = { target, side, entryId: entryFor(target, side)?.id ?? null }
    setHover(null)
    setPractice({ ...of, review: null, moves: [], status: 'checking', options: [], shown: false, mistakes: 0, wrong: null })
    void advance(id, of, [], 0)
  }

  /** Open an opening from the repertoire and practise it as its side. */
  const practiseEntry = (entry: RepertoireEntry) => {
    setLine({ name: entry.name, eco: entry.eco, moves: entry.moves, pgn: numbered(sans(entry.moves)) })
    setPath(entry.moves)
    setAt(entry.moves.length)
    startPractice(entry.side as OpeningSide, entry.moves)
  }

  /** The next opening due for review (not the one just practised), if any. */
  const nextDue = (): RepertoireEntry | null => {
    const now = Date.now()
    return repertoire?.entries.find((e) => new Date(e.due).getTime() <= now && e.id !== practice?.entryId) ?? null
  }

  const practiceMove = (uci: string) => {
    const p = practice
    if (!p || (p.status !== 'thinking' && p.status !== 'wrong')) return
    if (p.options.some((o) => o.uci === uci)) {
      const played = [...p.moves, uci]
      setPractice({ ...p, moves: played, status: 'checking', wrong: null, shown: false })
      void advance(run.current, p, played, p.mistakes)
      return
    }
    const san = gameFrom(p.moves).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
    // A position counts once as a mistake, however many tries it takes.
    setPractice({ ...p, status: 'wrong', wrong: san, mistakes: p.status === 'wrong' ? p.mistakes : p.mistakes + 1 })
  }

  // Being shown the move counts as a mistake (unless a wrong try here already did): it wasn't recalled.
  const showAnswer = () =>
    setPractice((p) => p && { ...p, shown: true, mistakes: p.status === 'wrong' ? p.mistakes : p.mistakes + 1 })

  const stopPractice = () => {
    run.current++
    setPractice(null)
  }

  /**
   * Leave practice to go over the line just played: the board goes to where the opening's variations begin, with
   * the rest of the line ahead, so stepping forward shows the other book moves at each point. (Where a run ends,
   * no named line goes on, so there's nothing left to explore there.)
   */
  const goOverPractice = () => {
    if (!practice || !line) return
    const moves = practice.moves
    run.current++
    setPractice(null)
    setPath(moves)
    setAt(Math.min(line.moves.length, moves.length))
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
    practice, startPractice, practiceMove, showAnswer, stopPractice, goOverPractice,
    repertoire, entryFor, addToRepertoire, removeFromRepertoire, practiseEntry, nextDue,
    board,
  }
}
