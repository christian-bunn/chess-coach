import { useEffect, useState } from 'react'
import { formatClock, timeLeft, type Clock } from '../clock'

interface GameClockProps {
  clock: Clock
  side: 'white' | 'black'
  label: string
  /** It's this side's move (its clock is highlighted, and ticks if it's running). */
  toMove: boolean
}

/** One side's clock, shown above or below the board. */
export function GameClock({ clock, side, label, toMove }: GameClockProps) {
  const running = clock.running === side
  // Redraw while it runs; the time itself comes from the clock's start time, so it never drifts.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setTick((n) => n + 1), 100)
    return () => clearInterval(timer)
  }, [running])
  const ms = timeLeft(clock, side)
  return (
    <div className={`game-clock ${toMove ? 'to-move' : ''} ${ms < 20_000 ? 'low' : ''}`} aria-label={`${label}'s clock`}>
      <span className="clock-who">
        <span className={`clock-side ${side}`} aria-hidden />
        {label}
      </span>
      <span className="clock-time">{formatClock(ms)}</span>
    </div>
  )
}
