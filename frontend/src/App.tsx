import { Chess } from 'chess.js'
import { useEffect, useMemo, useState } from 'react'
import { api, type CoachConfig, type Eval, type Level, type VoiceOption } from './api'
import { Board } from './components/Board'
import { CoachPanel } from './components/CoachPanel'
import { EvalBar } from './components/EvalBar'
import { MoveList } from './components/MoveList'
import { NewGame } from './components/NewGame'
import type { MoveRef } from './moveRefs'
import { useCoachGame, type CoachMode, type RetryMode } from './useCoachGame'
import { canSpeak, setServerVoice, setVoiceName, speak, stopSpeaking } from './voice'

const VOICE_KEY = 'chess-coach.voice-name'
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
  const [config, setConfig] = useState<CoachConfig>({ coach_ai: false, model: null, via: null, voice: false })
  const coach = useCoachGame(config.coach_ai)
  const { phase, plies, userColor, actions } = coach
  const [levels, setLevels] = useState<Level[]>([])
  const [backendError, setBackendError] = useState<string | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [flipped, setFlipped] = useState(false)
  // A move from a coach message being shown on the board instead of the game.
  const [preview, setPreview] = useState<MoveRef | null>(null)
  const previewGame = useMemo(() => (preview ? new Chess(preview.fen) : null), [preview])
  // Previews (and going back from one) snap instantly; real moves animate again.
  const [instant, setInstant] = useState(false)
  const showPreview = (move: MoveRef | null) => {
    setInstant(true)
    setPreview(move)
  }
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

  // ← and → take back and go forward, unless you're typing a question.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
      if (e.key === 'ArrowLeft') actions.undo()
      if (e.key === 'ArrowRight') actions.forward()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const voiceAvailable = config.voice || canSpeak()

  const userChar = userColor === 'white' ? 'w' : 'b'
  const orientation = flipped ? (userColor === 'white' ? 'black' : 'white') : userColor
  const last = plies.at(-1)
  const lastWasUser = plies.length > 0 && ((plies.length - 1) % 2 === 0 ? 'w' : 'b') === userChar
  const evaluation: Eval | null = coach.evals.slice(0, plies.length + 1).findLast((e) => e != null) ?? null
  const settingUp = phase === 'setup' || showSetup

  return (
    <div className="app">
      <header>
        <h1>
          <span aria-hidden>♞</span> Chess Coach
        </h1>
        {coach.level && phase !== 'setup' && (
          <span className="muted">
            vs {coach.level.name} (~{coach.level.elo}) · you play {userColor}
          </span>
        )}
      </header>
      <main>
        <div className="board-area">
          <EvalBar evaluation={phase === 'setup' ? null : evaluation} orientation={orientation} />
          <Board
            game={previewGame ?? coach.game}
            orientation={orientation}
            interactive={!preview && !settingUp && phase === 'user' && coach.game.turn() === userChar}
            userColor={userChar}
            lastMove={
              preview
                ? { from: preview.from, to: preview.to }
                : last
                  ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) }
                  : null
            }
            badge={
              !preview && last?.grade && lastWasUser
                ? { square: last.uci.slice(2, 4), classification: last.grade.classification }
                : null
            }
            arrows={
              preview
                ? [{ startSquare: preview.from, endSquare: preview.to, color: 'rgba(74, 159, 216, 0.9)' }]
                : coach.hintArrow
                  ? [{ startSquare: coach.hintArrow.from, endSquare: coach.hintArrow.to, color: 'rgba(129, 182, 76, 0.9)' }]
                  : []
            }
            onMove={actions.playMove}
            caption={preview?.label}
            animate={!instant}
          />
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
          ) : settingUp ? (
            levels.length > 0 ? (
              <NewGame
                levels={levels}
                initialLevel={coach.level?.id ?? 'casual'}
                onStart={(color, level) => {
                  setShowSetup(false)
                  setFlipped(false)
                  actions.newGame(color, level)
                }}
                onCancel={phase === 'setup' ? undefined : () => setShowSetup(false)}
              />
            ) : (
              <p className="muted">Connecting to the engine…</p>
            )
          ) : (
            <>
              <CoachPanel
                messages={coach.messages}
                phase={phase}
                canShowBest={!!coach.pendingRetry?.best_move}
                coachAI={config.coach_ai ? config : null}
                onTryAgain={() => actions.tryAgain(false)}
                onShowBest={() => actions.tryAgain(true)}
                onContinue={actions.continueGame}
                onRetryFailed={actions.retryFailed}
                canHint={coach.canHint}
                hintsUsed={coach.hintsUsed}
                onHint={actions.requestHint}
                onAsk={actions.ask}
                onPreview={showPreview}
              />
              <div className="controls">
                <button onClick={actions.undo} disabled={!coach.canUndo} title="Take back your last move (←)">
                  ↶ Take back
                </button>
                <button onClick={actions.forward} disabled={!coach.canRedo} title="Put back what you took back (→)">
                  Forward ↷
                </button>
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
              <MoveList plies={plies} />
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
                  <label title="Read key comments, hints and answers aloud">
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
                <p className="coach-source">
                  {config.coach_ai && config.via === 'claude-code' ? (
                    <>Comments by Claude ({config.model}) through Claude Code, on your Claude plan.</>
                  ) : config.coach_ai ? (
                    <>Comments by Claude ({config.model}) through the Anthropic API, billed to your API key.</>
                  ) : (
                    <>Built-in comments. Log in to Claude Code to have Claude explain each move (see README).</>
                  )}
                </p>
              </details>
            </>
          )}
        </aside>
      </main>
    </div>
  )
}
