import { Chess } from 'chess.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Classification, type Eval, type FriendGameView, type FriendHelp, type FriendLobby } from './api'
import type { Clock } from './clock'
import { buildGame, moveLabel, type Ply, type ReviewSnapshot, type Side } from './useCoachGame'

/** What the board shows in a game against a friend. */
export interface FriendBoard {
  game: Chess
  interactive: boolean
  lastMove: { from: string; to: string } | null
  badge: { square: string; classification: Classification } | null
  caption?: string
}

// How often the lobby is checked for challenges: often while you're looking at it.
const LOBBY_EVERY_MS = 3000
const LOBBY_IDLE_MS = 15000
// Following a game: retries after a failed request, and how many failures in a row end it.
const RETRY_MS = 2000
const GIVE_UP_AFTER = 4

/** How the game ended, for `view.you`. */
export function friendResult(view: FriendGameView): string {
  const r = view.result
  if (!r) return ''
  const you = view.you
  const them = you === 'white' ? view.names.black : view.names.white
  const opponent = them ?? 'Your opponent'
  const won = r.winner === you
  switch (r.reason) {
    case 'checkmate':
      return won ? 'Checkmate. You win!' : `Checkmate. ${opponent} wins.`
    case 'resigned':
      return won ? `${opponent} resigned. You win!` : `You resigned. ${opponent} wins.`
    case 'timeout': {
      const youFlagged = you !== null && view.clock?.[you] === 0
      if (r.winner === null) {
        return youFlagged
          ? `You ran out of time, but ${opponent} can't checkmate: it's a draw.`
          : `${opponent} ran out of time, but you can't checkmate: it's a draw.`
      }
      return won ? `${opponent} ran out of time. You win!` : `You ran out of time. ${opponent} wins.`
    }
    case 'agreed':
      return 'Draw agreed.'
    case 'stalemate':
      return "Stalemate: it's a draw."
    case 'insufficient':
      return "Neither of you can checkmate with what's left: it's a draw."
    case 'repetition':
      return "The same position came up three times: it's a draw."
    case 'fifty':
      return "Fifty moves without a capture or a pawn move: it's a draw."
    default:
      return 'The game is over.'
  }
}

/**
 * Playing a friend on the same server: the lobby of challenges, and following your game (a long poll, so the other
 * player's moves show up straight away). `active`: the Friend section is on screen, so the lobby is checked often.
 */
export function useFriendGame(active: boolean) {
  const [lobby, setLobby] = useState<FriendLobby | null>(null)
  const [gameId, setGameId] = useState<string | null>(null)
  // The game, and when it arrived (the clock runs from then).
  const [state, setState] = useState<{ view: FriendGameView; at: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [viewPly, setViewPly] = useState<number | null>(null)
  // The newest version of the game received, so a reply arriving late can't undo a newer one; and while your
  // move is on its way, how many moves the game has with it (it's shown before the server has it).
  const latest = useRef<{ id: string; version: number } | null>(null)
  const sending = useRef<number | null>(null)
  const view = state?.view ?? null

  const receive = (next: FriendGameView, reply = false) => {
    const seen = latest.current
    if (seen && seen.id === next.id && next.version < seen.version) return
    if (!reply && sending.current !== null && next.moves.length < sending.current) return
    latest.current = { id: next.id, version: next.version }
    setState({ view: next, at: Date.now() })
  }

  const refreshLobby = () =>
    api.friends.lobby().then(
      (l) => {
        setLobby(l)
        // Back after a reload: pick up the game (or challenge) you had going.
        if (l.game && !gameId) setGameId(l.game)
      },
      () => {},
    )

  // The lobby, while there's no game to follow.
  useEffect(() => {
    if (gameId) return
    void refreshLobby()
    const timer = setInterval(() => void refreshLobby(), active ? LOBBY_EVERY_MS : LOBBY_IDLE_MS)
    return () => clearInterval(timer)
  }, [gameId, active])

  // Following the game until it's over and every move has been graded (for the review).
  useEffect(() => {
    if (!gameId) return
    const controller = new AbortController()
    let failures = 0
    const follow = async () => {
      let after = -1
      while (!controller.signal.aborted) {
        try {
          const next = await api.friends.follow(gameId, after, controller.signal)
          failures = 0
          if (controller.signal.aborted) return
          receive(next)
          after = next.version
          const finished = next.status === 'over' && next.grades?.every(Boolean) && next.evals?.[0]
          if (finished) return
        } catch {
          if (controller.signal.aborted) return
          if (++failures >= GIVE_UP_AFTER) {
            setError("Lost touch with the game: the server may have restarted, which ends games.")
            setGameId(null)
            setState(null)
            return
          }
          await new Promise((r) => setTimeout(r, RETRY_MS))
        }
      }
    }
    void follow()
    return () => controller.abort()
  }, [gameId])

  const act = async (request: () => Promise<FriendGameView>) => {
    setError(null)
    try {
      const next = await request()
      receive(next, true)
      setGameId(next.id)
      return next
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }

  const challenge = (color: Side | 'random', timeControl: string, help: FriendHelp) =>
    act(() => api.friends.challenge({ color, time_control: timeControl, help }))

  const join = (id: string) => act(() => api.friends.join(id))

  /** Back to the lobby (after a game, or taking back your challenge). */
  const leave = async () => {
    if (view?.status === 'waiting' && view.host) await api.friends.cancel(view.id).catch(() => {})
    setGameId(null)
    setState(null)
    setReviewOpen(false)
    setViewPly(null)
    latest.current = null
    void refreshLobby()
  }

  const game = useMemo(() => buildGame((view?.moves ?? []).map((uci) => ({ uci, san: '', grade: null }))), [view?.moves])
  const you: Side | null = view?.you ?? null
  const myTurn = view?.status === 'playing' && you !== null && game.turn() === you[0]

  const move = (uci: string) => {
    if (!view || !myTurn || viewPly !== null) return
    // Shown straight away; the server's reply (and the clock) follows.
    const local = new Chess(game.fen())
    let san: string
    try {
      san = local.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
    } catch {
      return // illegal
    }
    setState((s) =>
      s && {
        at: Date.now(),
        view: {
          ...s.view,
          moves: [...s.view.moves, uci],
          sans: [...s.view.sans, san],
          grades: s.view.grades && [...s.view.grades, null],
          clock: s.view.clock && { ...s.view.clock, running: null },
        },
      },
    )
    sending.current = view.moves.length + 1
    void act(() => api.friends.move(view.id, uci)).then((sent) => {
      sending.current = null
      // Refused (the game ended meanwhile, say): show the game as the server has it.
      if (!sent) void api.friends.follow(view.id, -1).then((now) => receive(now, true), () => {})
    })
  }

  const resign = () => view && act(() => api.friends.resign(view.id))
  const draw = (action: 'offer' | 'accept' | 'decline') => view && act(() => api.friends.draw(view.id, action))

  const plies: Ply[] = useMemo(
    () => (view?.moves ?? []).map((uci, i) => ({ uci, san: view!.sans[i], grade: view!.grades?.[i] ?? null })),
    [view],
  )
  const gradesShown = !!view && (view.help === 'graded' || view.status === 'over')

  // Looking back at an earlier position (the number of moves played by then); null for the current one.
  const viewing = viewPly !== null && viewPly >= 1 && viewPly < plies.length ? viewPly : null
  const step = (ply: number | null) => setViewPly(ply === null || ply >= plies.length ? null : Math.max(1, ply))

  const board = useMemo((): FriendBoard | null => {
    if (!view || view.status === 'waiting') return null
    const shownPlies = viewing ?? plies.length
    const last = plies[shownPlies - 1]
    return {
      game: viewing === null ? game : buildGame(plies.slice(0, viewing)),
      interactive: myTurn && viewing === null,
      lastMove: last ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) } : null,
      badge: last?.grade && gradesShown ? { square: last.uci.slice(2, 4), classification: last.grade.classification } : null,
      caption:
        viewing !== null && last ? `${moveLabel(viewing - 1, last.san)} · an earlier position. ⏭ goes back to the game.` : undefined,
    }
  }, [view, viewing, plies, game, myTurn, gradesShown])

  const evaluation: Eval | null = gradesShown
    ? (view?.evals?.slice(0, (viewing ?? plies.length) + 1).findLast((e) => e != null) ?? null)
    : null

  const clock: Clock | null = useMemo(() => {
    const c = state?.view.clock
    if (!c || !state) return null
    return { white: c.white, black: c.black, increment: c.increment, running: c.running, since: c.running ? state.at : null }
  }, [state])

  // The review, once the game is over and every move has been graded.
  const reviewReady = view?.status === 'over' && plies.length > 0 && plies.every((p) => p.grade)
  const review: ReviewSnapshot | null = useMemo(
    () =>
      view && reviewReady && you
        ? { plies, evals: view.evals ?? [], userColor: you, result: friendResult(view) }
        : null,
    [view, reviewReady, plies, you],
  )

  return {
    lobby,
    view,
    error,
    you,
    myTurn,
    opponent: view && you ? (you === 'white' ? view.names.black : view.names.white) : null,
    plies,
    gradesShown,
    viewing,
    step,
    board,
    evaluation,
    clock,
    review,
    reviewOpen: reviewOpen && review !== null,
    openReview: () => setReviewOpen(true),
    closeReview: () => setReviewOpen(false),
    challenge,
    join,
    leave,
    move,
    resign,
    draw,
  }
}

export type FriendGame = ReturnType<typeof useFriendGame>
