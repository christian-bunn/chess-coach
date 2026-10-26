import { Chess } from 'chess.js'
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { api, type CoachConfig, type Eval, type Level } from './api'
import { Board } from './components/Board'
import { CoachPanel } from './components/CoachPanel'
import { EvalBar } from './components/EvalBar'
import { FriendPanel } from './components/FriendPanel'
import { GameClock } from './components/GameClock'
import { GameReview } from './components/GameReview'
import { MoveList } from './components/MoveList'
import { NewGame } from './components/NewGame'
import { OpeningsPanel } from './components/OpeningsPanel'
import { PuzzlePanel } from './components/PuzzlePanel'
import { SavedGames, matchup, savedOn } from './components/SavedGames'
import type { BoardPreview } from './moveRefs'
import { openingOf, previewMove } from './review'
import { buildGame, moveLabel, useCoachGame, type CoachMode, type RetryMode, type ReviewSnapshot } from './useCoachGame'
import { useFriendGame } from './useFriendGame'
import { useOpenings } from './useOpenings'
import { usePuzzles } from './usePuzzles'
import { useSavedGames } from './useSavedGames'
import { useReviewPractice } from './useReviewPractice'
import { canSpeak, setServerVoice, stopSpeaking } from './voice'

const MOVE_ARROW = 'rgba(74, 159, 216, 0.9)'
const BEST_ARROW = 'rgba(129, 182, 76, 0.9)'

type Mode = 'play' | 'puzzles' | 'saved' | 'openings' | 'friend'

/** `player`: whose progress this is (see player.ts); `onSwitchPlayer` asks for another name. */
export default function App({ player, onSwitchPlayer }: { player: string; onSwitchPlayer: () => void }) {
  const [config, setConfig] = useState<CoachConfig>({ voice: false })
  const puzzles = usePuzzles()
  const [mode, setMode] = useState<Mode>('play')
  // The game's clock only runs while it's on screen.
  const coach = useCoachGame(puzzles.refresh, mode !== 'play')
  // A solved puzzle played on is a graded game of its own, so the game in Play isn't touched.
  const puzzleGame = useCoachGame(puzzles.refresh)
  const savedGames = useSavedGames()
  const openings = useOpenings()
  // A game against a friend on the same server; it carries on (and its clocks run) whichever section is showing.
  const friend = useFriendGame(mode === 'friend')
  const puzzleMode = mode === 'puzzles'
  const savedMode = mode === 'saved'
  const openingsMode = mode === 'openings'
  const friendMode = mode === 'friend'
  const { phase, plies, userColor, actions } = coach
  const [levels, setLevels] = useState<Level[]>([])
  const [backendError, setBackendError] = useState<string | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [flipped, setFlipped] = useState(false)
  // A move from a coach message or a review comment being shown on the board instead of the game.
  const [preview, setPreview] = useState<BoardPreview | null>(null)
  // Previews (and going back from one) snap instantly; real moves animate again.
  const [instant, setInstant] = useState(false)
  const showPreview = (move: BoardPreview | null) => {
    setInstant(true)
    setPreview(move)
  }

  // The game review, of the game being played or of a saved game: the move it's showing on the board, and
  // replaying a move from it.
  const review = savedMode
    ? (savedGames.open?.review ?? null)
    : mode === 'play' && coach.reviewOpen
      ? coach.review
      : friendMode && friend.reviewOpen
        ? friend.review
        : null
  const [reviewView, setReviewView] = useState<{ ply: number; withBest: boolean } | null>(null)
  const practice = useReviewPractice(review)
  const practiceBoard = review ? practice.board : null
  const reviewPreview = useMemo(
    () => (review && reviewView ? previewMove(review, reviewView.ply, reviewView.withBest) : null),
    [review, reviewView],
  )
  const selectReviewMove = (ply: number | null, withBest = false) => {
    practice.stop()
    setInstant(true)
    setReviewView(ply === null ? null : { ply, withBest })
  }
  const openReview = () => {
    setPreview(null)
    setViewPly(null)
    setReviewView(null)
    practice.stop()
    if (friendMode) friend.openReview()
    else actions.openReview()
  }
  const closeReview = () => {
    setPreview(null)
    setReviewView(null)
    practice.stop()
    setInstant(true)
    if (friendMode) friend.closeReview()
    else actions.closeReview()
  }
  const switchMode = (next: Mode) => {
    if (next === mode) return
    stopSpeaking()
    setPreview(null)
    setReviewView(null)
    practice.stop()
    setInstant(true)
    setMode(next)
    if (next === 'puzzles') puzzles.refresh()
    if (next === 'saved') savedGames.refresh()
  }

  // Saving the game under review (the button then says so), and opening and deleting saved games.
  const [savedReview, setSavedReview] = useState<ReviewSnapshot | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'failed'>('idle')
  const saveReview = async () => {
    const snapshot = review
    if (!snapshot || saveState === 'saving') return
    setSaveState('saving')
    try {
      if (friendMode) await savedGames.save(snapshot, `${friend.opponent ?? 'A friend'} (friend)`, friend.view?.help ?? 'unassisted')
      else await savedGames.save(snapshot, coach.level ? `${coach.level.name} (~${coach.level.elo})` : null, coach.assistance)
      setSavedReview(snapshot)
      setSaveState('idle')
    } catch {
      setSaveState('failed')
    }
  }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const openSaved = (id: string) => {
    setPreview(null)
    setReviewView(null)
    practice.stop()
    setConfirmDelete(false)
    setInstant(true)
    void savedGames.show(id)
  }
  // Playing a game from an opening position: in Play, against the level of the last game, in the usual mode. If a
  // game is in progress, the Openings page asks first.
  const [pendingPlay, setPendingPlay] = useState<{ moves: string[]; side: 'white' | 'black'; name: string } | null>(null)
  const startFrom = (from: { moves: string[]; side: 'white' | 'black'; name: string }) => {
    const level = coach.level ?? levels.find((l) => l.id === 'casual') ?? levels[0]
    if (!level) return
    setPendingPlay(null)
    setShowSetup(false)
    setFlipped(false)
    actions.playOnFrom(
      from.moves,
      from.side,
      level,
      coach.assistance,
      `Playing on from the ${from.name} against ${level.name} (about ${level.elo}).`,
    )
    switchMode('play')
  }
  const playFrom = (moves: string[], side: 'white' | 'black', name: string) => {
    const inProgress = phase !== 'setup' && phase !== 'over'
    if (inProgress) setPendingPlay({ moves, side, name })
    else startFrom({ moves, side, name })
  }

  const closeSaved = () => {
    setPreview(null)
    setReviewView(null)
    practice.stop()
    setInstant(true)
    savedGames.close()
  }
  // Looking back at an earlier position of the game (the number of moves played by then); null for the current one.
  // It never changes the game, and the board can't be moved until you're back at the current position.
  const [viewPly, setViewPly] = useState<number | null>(null)
  const viewing = viewPly !== null && viewPly >= 1 && viewPly < plies.length ? viewPly : null
  const pliesBefore = useRef(plies.length)
  useEffect(() => {
    // A take-back or a new game ends the look back; the opponent's move doesn't.
    if (plies.length < pliesBefore.current) setViewPly(null)
    pliesBefore.current = plies.length
  }, [plies.length])
  const stepTo = (ply: number | null) => {
    setInstant(true)
    setViewPly(ply === null || ply >= plies.length ? null : Math.max(1, ply))
  }
  // In a coached game you can play on from the position you're looking at: moving there takes back what came after.
  const yourTurnThere = viewing !== null && viewing % 2 === (userColor === 'white' ? 0 : 1)
  const canPlayHere = coach.coached && viewing !== null && phase !== 'bot' && phase !== 'grading'
  const playFromHere = (uci?: string) => {
    if (viewing === null) return
    actions.rewindTo(viewing)
    if (uci) actions.playMove(uci)
  }
  const browse = useMemo((): BoardPreview | null => {
    if (viewing === null) return null
    const ply = plies[viewing - 1]
    const hint = !canPlayHere
      ? '⏭ goes back to the game.'
      : yourTurnThere
        ? 'Make a move to play on from here (later moves are taken back), or ⏭ to go back.'
        : '↩ Play from here lets your opponent move, or ⏭ goes back.'
    return {
      fen: buildGame(plies.slice(0, viewing)).fen(),
      from: ply.uci.slice(0, 2),
      to: ply.uci.slice(2, 4),
      played: true,
      badge: coach.gradesHidden ? undefined : ply.grade?.classification,
      label: `${moveLabel(viewing - 1, ply.san)} · an earlier position. ${hint}`,
    }
  }, [viewing, plies, coach.gradesHidden, canPlayHere, yourTurnThere])

  const shown = preview ?? (review ? (practiceBoard ? null : reviewPreview) : mode === 'play' ? browse : null)
  const shownGame = useMemo(() => (shown ? new Chess(shown.fen) : null), [shown])
  useEffect(() => {
    api.levels().then(setLevels, (e: Error) => setBackendError(e.message))
    api.config().then((c) => {
      setServerVoice(c.voice)
      setConfig(c)
    }, () => {}) // without it, the built-in comments are used
  }, [])

  useEffect(() => setInstant(false), [plies.length, friend.plies.length])

  // Once a puzzle is solved (or played on after seeing the solution), the opponent plays on: a graded game against
  // the level of your last game.
  useEffect(() => {
    const solved = puzzles.puzzle
    if (!puzzles.playOn || !solved) return
    const level = coach.level ?? levels.find((l) => l.id === 'casual') ?? levels[0]
    if (!level) return
    puzzleGame.actions.playOnFrom(
      puzzles.playOn,
      solved.color,
      level,
      'graded',
      `Playing on from the puzzle against ${level.name} (about ${level.elo}).`,
    )
    // Only when a new line to play on from comes in.
  }, [puzzles.playOn])
  const playingOn = puzzleMode && puzzles.playOn !== null && puzzleGame.phase !== 'setup'
  const playOnStatus =
    puzzleGame.phase === 'over'
      ? (puzzleGame.messages.findLast((m) => m.kind === 'over')?.text ?? 'The game is over.')
      : puzzleGame.phase === 'bot'
        ? 'Your opponent is thinking…'
        : puzzleGame.phase === 'grading'
          ? 'Checking your move…'
          : 'Your move.'

  // ← and → step through the game (or the review). In a coached game, a move made from an earlier position
  // takes back what came after it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || puzzleMode || (savedMode && !review)) return
      if (openingsMode) {
        if (openings.line && !openings.practice) openings.step(openings.at + (e.key === 'ArrowLeft' ? -1 : 1))
        return
      }
      if (review) {
        if (practice.practice) return
        const step = e.key === 'ArrowLeft' ? -1 : 1
        const ply = Math.min(review.plies.length, Math.max(1, (reviewView?.ply ?? (step < 0 ? review.plies.length + 1 : 0)) + step))
        selectReviewMove(ply)
        return
      }
      if (friendMode) {
        const at = friend.viewing ?? friend.plies.length
        if (e.key === 'ArrowLeft') friend.step(at - 1)
        else if (friend.viewing !== null) friend.step(friend.viewing + 1)
        return
      }
      const at = viewing ?? plies.length
      if (e.key === 'ArrowLeft') stepTo(at - 1)
      else if (viewing !== null) stepTo(viewing + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const voiceAvailable = config.voice || canSpeak()

  const userChar = userColor === 'white' ? 'w' : 'b'
  // The side the board faces: yours in the game on show (a saved game's may differ from the current game's).
  const side = review?.userColor ?? (friendMode ? (friend.you ?? 'white') : userColor)
  const sideChar = side === 'white' ? 'w' : 'b'
  const orientation = flipped ? (side === 'white' ? 'black' : 'white') : side
  const last = plies.at(-1)
  const evaluation: Eval | null =
    viewing !== null
      ? (coach.evals[viewing] ?? null)
      : (coach.evals.slice(0, plies.length + 1).findLast((e) => e != null) ?? null)
  // In the review, the bar follows the position on the board: the move being looked at (after it, or before it
  // when comparing with the best move), or the move just tried.
  const reviewEvaluation: Eval | null = !review
    ? null
    : practice.practice
      ? (practice.practice.attempt?.eval_after ?? review.evals[practice.practice.ply - 1] ?? null)
      : reviewView
        ? (review.evals[reviewPreview?.played ? reviewView.ply : reviewView.ply - 1] ?? null)
        : (review.evals.at(-1) ?? null)
  const settingUp = phase === 'setup' || showSetup
  // The clocks, for a timed game in Play or against a friend: the opponent's above the board and yours below
  // (whichever way it faces).
  const friendPlaying = friendMode && !!friend.view && friend.view.status !== 'waiting'
  const clock = mode === 'play' && phase !== 'setup' && !settingUp ? coach.clock : friendPlaying ? friend.clock : null
  const toMove = friendMode
    ? friend.view?.status === 'playing'
      ? friend.plies.length % 2 === 0
        ? 'white'
        : 'black'
      : null
    : phase === 'over'
      ? null
      : coach.game.turn() === 'w'
        ? 'white'
        : 'black'
  const clockLabel = (side: 'white' | 'black') =>
    friendMode
      ? side === friend.you
        ? 'You'
        : (friend.opponent ?? 'Opponent')
      : side === userColor
        ? 'You'
        : (coach.level?.name ?? 'Opponent')
  const opening = useMemo(() => openingOf(friendMode ? friend.plies : plies), [friendMode, friend.plies, plies])

  // What the board shows: a puzzle, a move being retried from the review, a move being previewed, or the game.
  let view: ComponentProps<typeof Board>
  const puzzleBoard = puzzleMode ? puzzles.board : null
  if (openingsMode) {
    const b = openings.board
    const side = b?.orientation ?? 'white'
    view = {
      game: b?.game ?? new Chess(),
      orientation: flipped ? (side === 'white' ? 'black' : 'white') : side,
      interactive: b?.interactive ?? false,
      userColor: b?.userColor ?? 'w',
      lastMove: b?.lastMove ?? null,
      badge: null,
      arrows: b?.arrow
        ? [{ startSquare: b.arrow.from, endSquare: b.arrow.to, color: openings.practice ? BEST_ARROW : MOVE_ARROW }]
        : [],
      onMove: (uci) => (openings.practice ? openings.practiceMove(uci) : openings.explore(uci)),
    }
  } else if (playingOn) {
    const color = puzzleGame.userColor
    const ownChar = color === 'white' ? 'w' : 'b'
    const final = puzzleGame.plies.at(-1)
    view = {
      game: puzzleGame.game,
      orientation: flipped ? (color === 'white' ? 'black' : 'white') : color,
      interactive: puzzleGame.phase === 'user' && puzzleGame.game.turn() === ownChar,
      userColor: ownChar,
      lastMove: final ? { from: final.uci.slice(0, 2), to: final.uci.slice(2, 4) } : null,
      badge: final?.grade ? { square: final.uci.slice(2, 4), classification: final.grade.classification } : null,
      arrows: [],
      onMove: puzzleGame.actions.playMove,
    }
  } else if (puzzleMode) {
    const color = puzzles.puzzle?.color ?? 'white'
    view = {
      game: puzzleBoard?.game ?? new Chess(),
      orientation: flipped ? (color === 'white' ? 'black' : 'white') : color,
      interactive: puzzleBoard?.interactive ?? false,
      userColor: color === 'white' ? 'w' : 'b',
      lastMove: puzzleBoard?.lastMove ?? null,
      badge: puzzleBoard?.badge ?? null,
      arrows: puzzleBoard?.solution
        ? [{ startSquare: puzzleBoard.solution.from, endSquare: puzzleBoard.solution.to, color: BEST_ARROW }]
        : [],
      onMove: (uci) => void puzzles.play(uci),
    }
  } else if (practiceBoard && !preview) {
    view = {
      game: practiceBoard.game,
      orientation,
      interactive: practiceBoard.interactive,
      userColor: sideChar,
      lastMove: practiceBoard.lastMove,
      badge: practiceBoard.badge,
      arrows: practiceBoard.best
        ? [{ startSquare: practiceBoard.best.from, endSquare: practiceBoard.best.to, color: BEST_ARROW }]
        : [],
      onMove: (uci) => void practice.play(uci),
      caption: practiceBoard.caption,
    }
  } else if (shown && shownGame) {
    view = {
      game: shownGame,
      orientation,
      interactive: shown === browse && canPlayHere && yourTurnThere,
      userColor: sideChar,
      lastMove: { from: shown.from, to: shown.to },
      badge: shown.badge ? { square: shown.to, classification: shown.badge } : null,
      arrows: [
        ...(shown.played ? [] : [{ startSquare: shown.from, endSquare: shown.to, color: MOVE_ARROW }]),
        ...(shown.best ? [{ startSquare: shown.best.from, endSquare: shown.best.to, color: BEST_ARROW }] : []),
      ],
      onMove: shown === browse && canPlayHere ? (uci) => playFromHere(uci) : () => {},
      caption: shown.label,
    }
  } else if (friendMode) {
    const b = friend.board
    view = {
      game: b?.game ?? new Chess(),
      orientation,
      interactive: b?.interactive ?? false,
      userColor: sideChar,
      lastMove: b?.lastMove ?? null,
      badge: b?.badge ?? null,
      arrows: [],
      onMove: friend.move,
      caption: b?.caption,
    }
  } else if (savedMode) {
    // A saved game's final position, or an empty board while choosing one.
    const final = review?.plies.at(-1)
    view = {
      game: review ? buildGame(review.plies) : new Chess(),
      orientation,
      interactive: false,
      userColor: sideChar,
      lastMove: final ? { from: final.uci.slice(0, 2), to: final.uci.slice(2, 4) } : null,
      badge: final?.grade ? { square: final.uci.slice(2, 4), classification: final.grade.classification } : null,
      arrows: [],
      onMove: () => {},
    }
  } else {
    view = {
      game: coach.game,
      orientation,
      interactive: !review && !settingUp && phase === 'user' && coach.game.turn() === userChar,
      userColor: userChar,
      lastMove: last ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) } : null,
      badge:
        last?.grade && !coach.gradesHidden
          ? { square: last.uci.slice(2, 4), classification: last.grade.classification }
          : null,
      arrows:
        coach.hintArrow && !review
          ? [{ startSquare: coach.hintArrow.from, endSquare: coach.hintArrow.to, color: BEST_ARROW }]
          : [],
      onMove: actions.playMove,
      highlight: review ? null : coach.pieceHint,
    }
  }

  // The game review's panel: of the game in Play, a game against a friend, or a saved game.
  const reviewPanel = (props: Pick<ComponentProps<typeof GameReview>, 'onClose' | 'closeLabel' | 'subtitle' | 'actions'>) =>
    review && (
      <GameReview
        review={review}
        selected={practice.practice?.ply ?? reviewView?.ply ?? null}
        onSelect={selectReviewMove}
        withBest={reviewView?.withBest ?? false}
        practice={practice.practice}
        onPractice={(ply) => {
          setReviewView(null)
          setInstant(true)
          practice.start(ply)
        }}
        onTryAgain={practice.tryAgain}
        onShowBest={practice.showBest}
        onStopPractice={practice.stop}
        onPreview={showPreview}
        {...props}
      />
    )
  const saveButton = (
    <button
      className={savedReview === review ? '' : 'primary'}
      onClick={() => void saveReview()}
      disabled={savedReview === review || saveState === 'saving'}
      title="Keep this game in Saved, to go over it again later"
    >
      {savedReview === review
        ? '✓ Saved'
        : saveState === 'saving'
          ? 'Saving…'
          : saveState === 'failed'
            ? "Couldn't save: try again"
            : '💾 Save game'}
    </button>
  )

  return (
    <div className="app">
      <header>
        <h1>
          <span aria-hidden>♞</span> Chess Coach
        </h1>
        {mode === 'play' && coach.level && phase !== 'setup' && (
          <span className="muted">
            vs {coach.level.name} (~{coach.level.elo}) · you play {userColor}
          </span>
        )}
        {friendPlaying && (
          <span className="muted">
            vs {friend.opponent} (friend) · you play {friend.you}
          </span>
        )}
        {((mode === 'play' && phase !== 'setup') || friendPlaying) && opening && (
          <span className="opening-name" title={`${opening.eco ?? ''} ${opening.name}`.trim()}>
            📖 {opening.name}
          </span>
        )}
        <nav className="mode-switch" aria-label="Mode">
          <button className={mode === 'play' ? 'active' : ''} onClick={() => switchMode('play')} aria-pressed={mode === 'play'}>
            ♟ Play
          </button>
          <button className={puzzleMode ? 'active' : ''} onClick={() => switchMode('puzzles')} aria-pressed={puzzleMode}>
            🧩 Puzzles
            {!!puzzles.summary?.due && <span className="count">{puzzles.summary.due}</span>}
          </button>
          <button className={savedMode ? 'active' : ''} onClick={() => switchMode('saved')} aria-pressed={savedMode}>
            📁 Saved
          </button>
          <button className={openingsMode ? 'active' : ''} onClick={() => switchMode('openings')} aria-pressed={openingsMode}>
            📚 Openings
            {!!openings.repertoire?.due && <span className="count">{openings.repertoire.due}</span>}
          </button>
          <button
            className={friendMode ? 'active' : ''}
            onClick={() => switchMode('friend')}
            aria-pressed={friendMode}
            title={friend.myTurn && !friendMode ? 'Your move against your friend' : 'Play a friend'}
          >
            👥 Friend
            {friend.myTurn && !friendMode ? (
              <span className="count">!</span>
            ) : (
              !friend.view && !!friend.lobby?.challenges.length && <span className="count">{friend.lobby.challenges.length}</span>
            )}
          </button>
          <button className="player-button" onClick={onSwitchPlayer} title="Switch player">
            👤 {player}
          </button>
        </nav>
      </header>
      <main>
        <div className={`board-area ${clock ? 'timed' : ''}`}>
          {/* No evaluation while solving a puzzle or during an unassisted game: it would give away whether there's
              something to find. (Once a puzzle is finished, it follows the position you explore.) */}
          <EvalBar
            evaluation={
              openingsMode
                ? openings.practice
                  ? null
                  : openings.evaluation
                : puzzleMode
                ? playingOn
                  ? (puzzleGame.evals.findLast((e) => e != null) ?? null)
                  : null
                : savedMode
                  ? reviewEvaluation
                  : friendMode
                  ? (reviewEvaluation ?? friend.evaluation)
                  : phase === 'setup' || coach.gradesHidden
                  ? null
                  : (reviewEvaluation ?? evaluation)
            }
            orientation={view.orientation}
          />
          <div className="board-column">
            {clock && (
              <GameClock
                clock={clock}
                side={view.orientation === 'white' ? 'black' : 'white'}
                label={clockLabel(view.orientation === 'white' ? 'black' : 'white')}
                toMove={toMove === (view.orientation === 'white' ? 'black' : 'white')}
              />
            )}
            <Board {...view} animate={!instant} />
            {clock && (
              <GameClock clock={clock} side={view.orientation} label={clockLabel(view.orientation)} toMove={toMove === view.orientation} />
            )}
          </div>
        </div>
        <aside className="side">
          {backendError ? (
            <section className="new-game">
              <h2>Can't reach the coach</h2>
              <p>
                The backend isn't responding ({backendError}). Start it with <code>./dev.sh</code> from the project
                folder, then reload this page.
              </p>
            </section>
          ) : puzzleMode ? (
            <PuzzlePanel
              summary={puzzles.summary}
              list={puzzles.list}
              puzzle={puzzles.puzzle}
              status={puzzles.status}
              attempt={puzzles.attempt}
              scheduled={puzzles.scheduled}
              loading={puzzles.loading}
              playOn={playingOn ? { plies: puzzleGame.plies, status: playOnStatus } : null}
              onNext={() => void puzzles.next()}
              onOpen={(id) => void puzzles.open(id)}
              onClose={puzzles.close}
              onTryAgain={puzzles.tryAgain}
              onShowSolution={puzzles.showSolution}
              onRemove={() => void puzzles.remove()}
            />
          ) : openingsMode ? (
            <OpeningsPanel
              openings={openings}
              onPlayFrom={playFrom}
              confirmingPlay={pendingPlay !== null}
              onConfirmPlay={() => pendingPlay && startFrom(pendingPlay)}
              onCancelPlay={() => setPendingPlay(null)}
            />
          ) : savedMode ? (
            review && savedGames.open ? (
              reviewPanel({
                onClose: closeSaved,
                closeLabel: '← Saved games',
                subtitle: `${matchup(savedGames.open.summary)} · ${savedOn(savedGames.open.summary.saved)}`,
                actions: confirmDelete ? (
                  <>
                    <button onClick={() => void savedGames.remove(savedGames.open!.summary.id)}>Delete for good</button>
                    <button onClick={() => setConfirmDelete(false)}>Keep it</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDelete(true)}>🗑 Delete</button>
                ),
              })
            ) : (
              <SavedGames games={savedGames.games} onOpen={openSaved} onDelete={(id) => void savedGames.remove(id)} />
            )
          ) : friendMode ? (
            review ? (
              reviewPanel({ onClose: closeReview, actions: saveButton })
            ) : (
              <FriendPanel friend={friend} onReview={openReview} onFlip={() => setFlipped((f) => !f)} />
            )
          ) : settingUp ? (
            levels.length > 0 ? (
              <NewGame
                levels={levels}
                initialLevel={coach.level?.id ?? 'casual'}
                initialAssistance={coach.assistance}
                initialTimeControl={coach.timeControl}
                onStart={(color, level, assistance, timing) => {
                  setShowSetup(false)
                  setFlipped(false)
                  actions.newGame(color, level, assistance, timing)
                }}
                onCancel={phase === 'setup' ? undefined : () => setShowSetup(false)}
              />
            ) : (
              <p className="muted">Connecting to the engine…</p>
            )
          ) : review ? (
            reviewPanel({ onClose: closeReview, actions: saveButton })
          ) : (
            <>
              <CoachPanel
                messages={coach.messages}
                phase={phase}
                canShowBest={!!coach.pendingRetry?.best_move}
                onTryAgain={() => actions.tryAgain(false)}
                onShowBest={() => actions.tryAgain(true)}
                onContinue={actions.continueGame}
                onRetryFailed={actions.retryFailed}
                canIdea={coach.canIdea}
                onIdea={actions.requestIdea}
                canPiece={coach.canPiece}
                pieceStep={coach.pieceStep}
                onPiece={actions.revealPiece}
                canReview={coach.canReview}
                onReview={openReview}
                coached={coach.coached}
                onPreview={showPreview}
              />
              <div className="controls">
                {!coach.coached && (
                  <button onClick={actions.resign} disabled={phase === 'over'} title="Give up this game">
                    🏳 Resign
                  </button>
                )}
                <button onClick={() => setFlipped((f) => !f)} title="Flip the board">
                  ⇅ Flip
                </button>
                <button onClick={() => setShowSetup(true)}>New game</button>
                {voiceAvailable && (
                  <button
                    className="icon"
                    onClick={() => actions.setVoice(!coach.voice)}
                    title={coach.voice ? 'Stop speaking comments' : 'Speak key comments aloud'}
                    aria-pressed={coach.voice}
                  >
                    {coach.voice ? '🔊' : '🔇'}
                  </button>
                )}
              </div>
              <div className="move-nav" aria-label="Step through the game">
                <button onClick={() => stepTo(1)} disabled={plies.length < 2 || viewing === 1} title="First move">
                  ⏮
                </button>
                <button onClick={() => stepTo((viewing ?? plies.length) - 1)} disabled={(viewing ?? plies.length) <= 1} title="Previous move">
                  ◀
                </button>
                <button onClick={() => viewing !== null && stepTo(viewing + 1)} disabled={viewing === null} title="Next move">
                  ▶
                </button>
                <button onClick={() => stepTo(null)} disabled={viewing === null} title="Back to the game">
                  ⏭
                </button>
                {canPlayHere && (
                  <button className="primary" onClick={() => playFromHere()} title="Take back everything after this position and play on">
                    ↩ Play from here
                  </button>
                )}
              </div>
              <MoveList
                plies={plies}
                showGrades={!coach.gradesHidden}
                current={(viewing ?? plies.length) - 1}
                onSelect={(index) => stepTo(index + 1)}
              />
              <details className="settings">
                <summary>⚙ Settings</summary>
                <label className="setting">
                Offer a retry after
                <select value={coach.retryMode} onChange={(e) => actions.setRetryMode(e.target.value as RetryMode)}>
                  <option value="mistakes">mistakes, misses and blunders</option>
                  <option value="blunders">misses and blunders only</option>
                  <option value="off">never</option>
                </select>
              </label>
              <div className="setting">
                <label>
                  Coach comments
                  <select value={coach.coachMode} onChange={(e) => actions.setCoachMode(e.target.value as CoachMode)}>
                    <option value="key">at key moments</option>
                    <option value="all">on every move</option>
                  </select>
                </label>
                {voiceAvailable && (
                  <label title="Read key comments, hints and guidance aloud">
                    <input type="checkbox" checked={coach.voice} onChange={(e) => actions.setVoice(e.target.checked)} />
                    Speak
                  </label>
                )}
              </div>
                <p className="coach-source">Grades, comments and hints all come from Stockfish's analysis.</p>
              </details>
            </>
          )}
        </aside>
      </main>
    </div>
  )
}
