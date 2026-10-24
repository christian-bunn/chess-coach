import { Chess } from 'chess.js'
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { api, type CoachConfig, type Eval, type Level, type VoiceOption } from './api'
import { Board } from './components/Board'
import { CoachPanel } from './components/CoachPanel'
import { EvalBar } from './components/EvalBar'
import { GameReview } from './components/GameReview'
import { MoveList } from './components/MoveList'
import { NewGame } from './components/NewGame'
import { PuzzlePanel } from './components/PuzzlePanel'
import { SavedGames, matchup, savedOn } from './components/SavedGames'
import type { BoardPreview } from './moveRefs'
import { openingOf, previewMove } from './review'
import { buildGame, moveLabel, useCoachGame, type CoachMode, type RetryMode, type ReviewSnapshot } from './useCoachGame'
import { usePuzzles } from './usePuzzles'
import { useSavedGames } from './useSavedGames'
import { useReviewPractice } from './useReviewPractice'
import { canSpeak, setServerVoice, setVoiceName, speak, stopSpeaking } from './voice'

const VOICE_KEY = 'chess-coach.voice-name'
const MOVE_ARROW = 'rgba(74, 159, 216, 0.9)'
const BEST_ARROW = 'rgba(129, 182, 76, 0.9)'
const VOICE_SAMPLE =
  "Nice. 12.Nd5 hits the queen on c7 and the bishop on e7 at the same time, so your opponent can't save both."

function savedVoice(): string | null {
  try {
    return localStorage.getItem(VOICE_KEY)
  } catch {
    return null
  }
}

type Mode = 'play' | 'puzzles' | 'saved'

export default function App() {
  const [config, setConfig] = useState<CoachConfig>({ voice: false })
  const puzzles = usePuzzles()
  const coach = useCoachGame(puzzles.refresh)
  const savedGames = useSavedGames()
  // Playing a game, doing puzzles from your mistakes, or looking at saved games (the game waits meanwhile).
  const [mode, setMode] = useState<Mode>('play')
  const puzzleMode = mode === 'puzzles'
  const savedMode = mode === 'saved'
  const { phase, plies, userColor, actions } = coach
  const [levels, setLevels] = useState<Level[]>([])
  const [backendError, setBackendError] = useState<string | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [flipped, setFlipped] = useState(false)
  // A move from a coach message being shown on the board instead of the game.
  const [preview, setPreview] = useState<BoardPreview | null>(null)
  // Previews (and going back from one) snap instantly; real moves animate again.
  const [instant, setInstant] = useState(false)
  const showPreview = (move: BoardPreview | null) => {
    setInstant(true)
    setPreview(move)
  }

  // The game review, of the game being played or of a saved game: the move it's showing on the board, and
  // replaying a move from it.
  const review = savedMode ? (savedGames.open?.review ?? null) : mode === 'play' && coach.reviewOpen ? coach.review : null
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
    actions.openReview()
  }
  const closeReview = () => {
    setReviewView(null)
    practice.stop()
    setInstant(true)
    actions.closeReview()
  }
  const switchMode = (next: Mode) => {
    if (next === mode) return
    stopSpeaking()
    setPreview(null)
    setReviewView(null)
    practice.stop()
    setInstant(true)
    setMode(next)
    if (next === 'puzzles' && !puzzles.puzzle) void puzzles.load()
    if (next === 'saved') savedGames.refresh()
  }

  // Saving the game under review (the button then says so), and opening and deleting saved games.
  const [savedReview, setSavedReview] = useState<ReviewSnapshot | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'failed'>('idle')
  const saveReview = async () => {
    const snapshot = coach.review
    if (!snapshot || saveState === 'saving') return
    setSaveState('saving')
    try {
      await savedGames.save(snapshot, coach.level ? `${coach.level.name} (~${coach.level.elo})` : null, coach.assistance)
      setSavedReview(snapshot)
      setSaveState('idle')
    } catch {
      setSaveState('failed')
    }
  }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const openSaved = (id: string) => {
    setReviewView(null)
    practice.stop()
    setConfirmDelete(false)
    setInstant(true)
    void savedGames.show(id)
  }
  const closeSaved = () => {
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
  const browse = useMemo((): BoardPreview | null => {
    if (viewing === null) return null
    const ply = plies[viewing - 1]
    return {
      fen: buildGame(plies.slice(0, viewing)).fen(),
      from: ply.uci.slice(0, 2),
      to: ply.uci.slice(2, 4),
      played: true,
      badge: coach.gradesHidden ? undefined : ply.grade?.classification,
      label: `${moveLabel(viewing - 1, ply.san)} · an earlier position. ⏭ goes back to the game.`,
    }
  }, [viewing, plies, coach.gradesHidden])

  const shown = review ? (practiceBoard ? null : reviewPreview) : (preview ?? browse)
  const shownGame = useMemo(() => (shown ? new Chess(shown.fen) : null), [shown])
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [voice, setVoice] = useState<string | null>(null)

  const chooseVoice = (name: string, preview: boolean) => {
    setVoice(name)
    setVoiceName(name)
    try {
      localStorage.setItem(VOICE_KEY, name)
    } catch {
      // not remembered; fine
    }
    if (preview) {
      stopSpeaking()
      speak(VOICE_SAMPLE)
    }
  }

  useEffect(() => {
    api.levels().then(setLevels, (e: Error) => setBackendError(e.message))
    api.config().then((c) => {
      setServerVoice(c.voice)
      setConfig(c)
      if (c.voice) {
        api.voices().then((v) => {
          setVoices(v.voices)
          const saved = savedVoice()
          const name = v.voices.some((x) => x.name === saved) ? saved : v.default
          if (name) chooseVoice(name, false)
        }, () => {})
      }
    }, () => {}) // without it, the built-in comments are used
  }, [])

  useEffect(() => setInstant(false), [plies.length])

  // ← and → take back and go forward; in the review they step through the moves instead.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || puzzleMode || (savedMode && !review)) return
      if (!review && !coach.coached) {
        // Outside coached games the arrows step through the game (there are no take-backs).
        const at = viewing ?? plies.length
        if (e.key === 'ArrowLeft') stepTo(at - 1)
        else if (viewing !== null) stepTo(viewing + 1)
        return
      }
      if (review) {
        if (practice.practice) return
        const step = e.key === 'ArrowLeft' ? -1 : 1
        const ply = Math.min(review.plies.length, Math.max(1, (reviewView?.ply ?? (step < 0 ? review.plies.length + 1 : 0)) + step))
        selectReviewMove(ply)
      } else if (e.key === 'ArrowLeft') actions.undo()
      else actions.forward()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const voiceAvailable = config.voice || canSpeak()

  const userChar = userColor === 'white' ? 'w' : 'b'
  // The side the board faces: yours in the game on show (a saved game's may differ from the current game's).
  const side = review?.userColor ?? userColor
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
  const opening = useMemo(() => openingOf(plies), [plies])

  // What the board shows: a puzzle, a move being retried from the review, a move being previewed, or the game.
  let view: ComponentProps<typeof Board>
  const puzzleBoard = puzzleMode ? puzzles.board : null
  if (puzzleMode) {
    const color = puzzles.puzzle?.color ?? 'white'
    view = {
      game: puzzleBoard?.game ?? new Chess(),
      orientation: flipped ? (color === 'white' ? 'black' : 'white') : color,
      interactive: puzzleBoard?.interactive ?? false,
      userColor: puzzleBoard?.userColor ?? (color === 'white' ? 'w' : 'b'),
      lastMove: puzzleBoard?.lastMove ?? null,
      badge: puzzleBoard?.badge ?? null,
      arrows: puzzleBoard?.solution
        ? [{ startSquare: puzzleBoard.solution.from, endSquare: puzzleBoard.solution.to, color: BEST_ARROW }]
        : [],
      onMove: (uci) => void puzzles.play(uci),
      caption:
        puzzles.explore.length > 0 && puzzleBoard
          ? `Exploring · ${puzzleBoard.game.turn() === 'w' ? 'White' : 'Black'} to move`
          : undefined,
    }
  } else if (practiceBoard) {
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
      interactive: false,
      userColor: sideChar,
      lastMove: { from: shown.from, to: shown.to },
      badge: shown.badge ? { square: shown.to, classification: shown.badge } : null,
      arrows: [
        ...(shown.played ? [] : [{ startSquare: shown.from, endSquare: shown.to, color: MOVE_ARROW }]),
        ...(shown.best ? [{ startSquare: shown.best.from, endSquare: shown.best.to, color: BEST_ARROW }] : []),
      ],
      onMove: () => {},
      caption: shown.label,
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
        {mode === 'play' && opening && phase !== 'setup' && (
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
        </nav>
      </header>
      <main>
        <div className="board-area">
          {/* No evaluation while solving a puzzle or during an unassisted game: it would give away whether there's
              something to find. (Once a puzzle is finished, it follows the position you explore.) */}
          <EvalBar
            evaluation={
              puzzleMode
                ? puzzles.evaluation
                : savedMode
                  ? reviewEvaluation
                  : phase === 'setup' || coach.gradesHidden
                  ? null
                  : (reviewEvaluation ?? evaluation)
            }
            orientation={view.orientation}
          />
          <Board {...view} animate={!instant} />
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
              puzzle={puzzles.puzzle}
              status={puzzles.status}
              attempt={puzzles.attempt}
              scheduled={puzzles.scheduled}
              loading={puzzles.loading}
              onStart={(early) => void puzzles.load(early)}
              onTryAgain={puzzles.tryAgain}
              onShowSolution={puzzles.showSolution}
              onRemove={() => void puzzles.remove()}
              explored={puzzles.explore.length}
              onUndoExplore={puzzles.undoExplore}
              onResetExplore={puzzles.resetExplore}
            />
          ) : savedMode ? (
            review && savedGames.open ? (
              <GameReview
                review={review}
                selected={practice.practice?.ply ?? reviewView?.ply ?? null}
                onSelect={selectReviewMove}
                practice={practice.practice}
                onPractice={(ply) => {
                  setReviewView(null)
                  setInstant(true)
                  practice.start(ply)
                }}
                onTryAgain={practice.tryAgain}
                onShowBest={practice.showBest}
                onStopPractice={practice.stop}
                onClose={closeSaved}
                closeLabel="← Saved games"
                subtitle={`${matchup(savedGames.open.summary)} · ${savedOn(savedGames.open.summary.saved)}`}
                actions={
                  confirmDelete ? (
                    <>
                      <button onClick={() => void savedGames.remove(savedGames.open!.summary.id)}>Delete for good</button>
                      <button onClick={() => setConfirmDelete(false)}>Keep it</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(true)}>🗑 Delete</button>
                  )
                }
              />
            ) : (
              <SavedGames games={savedGames.games} onOpen={openSaved} onDelete={(id) => void savedGames.remove(id)} />
            )
          ) : settingUp ? (
            levels.length > 0 ? (
              <NewGame
                levels={levels}
                initialLevel={coach.level?.id ?? 'casual'}
                initialAssistance={coach.assistance}
                onStart={(color, level, assistance) => {
                  setShowSetup(false)
                  setFlipped(false)
                  actions.newGame(color, level, assistance)
                }}
                onCancel={phase === 'setup' ? undefined : () => setShowSetup(false)}
              />
            ) : (
              <p className="muted">Connecting to the engine…</p>
            )
          ) : review ? (
            <GameReview
              review={review}
              selected={practice.practice?.ply ?? reviewView?.ply ?? null}
              onSelect={selectReviewMove}
              practice={practice.practice}
              onPractice={(ply) => {
                setReviewView(null)
                setInstant(true)
                practice.start(ply)
              }}
              onTryAgain={practice.tryAgain}
              onShowBest={practice.showBest}
              onStopPractice={practice.stop}
              onClose={closeReview}
              actions={
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
              }
            />
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
                {coach.coached ? (
                  <>
                    <button onClick={actions.undo} disabled={!coach.canUndo || !!review} title="Take back your last move (←)">
                      ↶ Take back
                    </button>
                    <button onClick={actions.forward} disabled={!coach.canRedo || !!review} title="Put back what you took back (→)">
                      Forward ↷
                    </button>
                  </>
                ) : (
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
                {voices.length > 0 && (
                  <div className="setting">
                    <label>
                      Voice
                      <select value={voice ?? ''} onChange={(e) => chooseVoice(e.target.value, true)}>
                        {voices.map((v) => (
                          <option key={v.name} value={v.name}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" onClick={() => voice && chooseVoice(voice, true)} title="Hear this voice">
                      ▶ Test
                    </button>
                  </div>
                )}
                <p className="coach-source">Grades, comments and hints all come from Stockfish's analysis.</p>
              </details>
            </>
          )}
        </aside>
      </main>
    </div>
  )
}
