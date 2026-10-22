import { useEffect, useState } from 'react'
import { api, type CoachConfig, type Eval, type Level } from './api'
import { Board } from './components/Board'
import { CoachPanel } from './components/CoachPanel'
import { EvalBar } from './components/EvalBar'
import { MoveList } from './components/MoveList'
import { NewGame } from './components/NewGame'
import { useCoachGame, type CoachMode, type RetryMode } from './useCoachGame'
import { voiceSupported } from './voice'

export default function App() {
  const [config, setConfig] = useState<CoachConfig>({ coach_ai: false, model: null, via: null })
  const coach = useCoachGame(config.coach_ai)
  const { phase, plies, userColor, actions } = coach
  const [levels, setLevels] = useState<Level[]>([])
  const [backendError, setBackendError] = useState<string | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    api.levels().then(setLevels, (e: Error) => setBackendError(e.message))
    api.config().then(setConfig, () => {}) // without it, the built-in comments are used
  }, [])

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
            game={coach.game}
            orientation={orientation}
            interactive={!settingUp && phase === 'user' && coach.game.turn() === userChar}
            userColor={userChar}
            lastMove={last ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) } : null}
            badge={
              last?.grade && lastWasUser ? { square: last.uci.slice(2, 4), classification: last.grade.classification } : null
            }
            arrows={
              coach.hintArrow
                ? [{ startSquare: coach.hintArrow.from, endSquare: coach.hintArrow.to, color: 'rgba(129, 182, 76, 0.9)' }]
                : []
            }
            onMove={actions.playMove}
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
              />
              <div className="controls">
                <button onClick={actions.undo} disabled={!coach.canUndo} title="Take back your last move">
                  ↶ Take back
                </button>
                <button onClick={() => setFlipped((f) => !f)} title="Flip the board">
                  ⇅ Flip
                </button>
                <button onClick={() => setShowSetup(true)}>New game</button>
                {voiceSupported && (
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
                {voiceSupported && (
                  <label title="Read key comments, hints and answers aloud">
                    <input type="checkbox" checked={coach.voice} onChange={(e) => actions.setVoice(e.target.checked)} />
                    Speak
                  </label>
                )}
              </div>
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
