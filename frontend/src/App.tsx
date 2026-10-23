import { Chess } from 'chess.js'
import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import { api, type CoachConfig, type Eval, type Level, type VoiceOption } from './api'
import { Board } from './components/Board'
import { CoachPanel } from './components/CoachPanel'
import { EvalBar } from './components/EvalBar'
import { GameReview } from './components/GameReview'
import { MoveList } from './components/MoveList'
import { NewGame } from './components/NewGame'
import { PuzzlePanel } from './components/PuzzlePanel'
import type { BoardPreview } from './moveRefs'
import { openingOf, previewMove } from './review'
import { useCoachGame, type CoachMode, type RetryMode } from './useCoachGame'
import { usePuzzles } from './usePuzzles'
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

export default function App() {
  const [config, setConfig] = useState<CoachConfig>({ voice: false })
  const puzzles = usePuzzles()
  const coach = useCoachGame(puzzles.refresh)
  // Playing a game, or doing puzzles from your mistakes (the game waits meanwhile).
  const [mode, setMode] = useState<'play' | 'puzzles'>('play')
  const puzzleMode = mode === 'puzzles'
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

  // The game review: the move it's showing on the board, and replaying a move from it.
  const review = coach.reviewOpen ? coach.review : null
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
  const switchMode = (next: 'play' | 'puzzles') => {
    if (next === mode) return
    stopSpeaking()
    setPreview(null)
    setInstant(true)
    setMode(next)
    if (next === 'puzzles' && !puzzles.puzzle) void puzzles.load()
  }
  const shown = review ? (practiceBoard ? null : reviewPreview) : preview
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
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || puzzleMode) return
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
  const orientation = flipped ? (userColor === 'white' ? 'black' : 'white') : userColor
  const last = plies.at(-1)
  const evaluation: Eval | null = coach.evals.slice(0, plies.length + 1).findLast((e) => e != null) ?? null
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
      userColor: userChar,
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
      userColor: userChar,
      lastMove: { from: shown.from, to: shown.to },
      badge: shown.badge ? { square: shown.to, classification: shown.badge } : null,
      arrows: [
        ...(shown.played ? [] : [{ startSquare: shown.from, endSquare: shown.to, color: MOVE_ARROW }]),
        ...(shown.best ? [{ startSquare: shown.best.from, endSquare: shown.best.to, color: BEST_ARROW }] : []),
      ],
      onMove: () => {},
      caption: shown.label,
    }
  } else {
    view = {
      game: coach.game,
      orientation,
      interactive: !review && !settingUp && phase === 'user' && coach.game.turn() === userChar,
      userColor: userChar,
      lastMove: last ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) } : null,
      badge:
        last?.grade && !coach.helpHidden
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
        {!puzzleMode && coach.level && phase !== 'setup' && (
          <span className="muted">
            vs {coach.level.name} (~{coach.level.elo}) · you play {userColor}
          </span>
        )}
        {!puzzleMode && opening && phase !== 'setup' && (
          <span className="opening-name" title={`${opening.eco ?? ''} ${opening.name}`.trim()}>
            📖 {opening.name}
          </span>
        )}
        <nav className="mode-switch" aria-label="Mode">
          <button className={puzzleMode ? '' : 'active'} onClick={() => switchMode('play')} aria-pressed={!puzzleMode}>
            ♟ Play
          </button>
          <button className={puzzleMode ? 'active' : ''} onClick={() => switchMode('puzzles')} aria-pressed={puzzleMode}>
            🧩 Puzzles
            {!!puzzles.summary?.due && <span className="count">{puzzles.summary.due}</span>}
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
                : phase === 'setup' || coach.helpHidden
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
          ) : settingUp ? (
            levels.length > 0 ? (
              <NewGame
                levels={levels}
                initialLevel={coach.level?.id ?? 'casual'}
                initialAssisted={coach.assisted}
                onStart={(color, level, assisted) => {
                  setShowSetup(false)
                  setFlipped(false)
                  actions.newGame(color, level, assisted)
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
                assisted={coach.assisted}
                onPreview={showPreview}
              />
              <div className="controls">
                {coach.assisted ? (
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
              <MoveList plies={plies} showGrades={!coach.helpHidden} />
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
