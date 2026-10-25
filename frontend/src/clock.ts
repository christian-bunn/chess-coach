import type { Chess } from 'chess.js'

/** A time control: minutes each, plus seconds added after every move. */
export interface TimeControl {
  id: string
  label: string
  minutes: number
  increment: number
}

export const UNTIMED = 'untimed'

export const TIME_CONTROLS: TimeControl[] = [
  { id: '1', label: '1 min', minutes: 1, increment: 0 },
  { id: '3', label: '3 min', minutes: 3, increment: 0 },
  { id: '3+2', label: '3 | 2', minutes: 3, increment: 2 },
  { id: '5', label: '5 min', minutes: 5, increment: 0 },
  { id: '10', label: '10 min', minutes: 10, increment: 0 },
  { id: '10+5', label: '10 | 5', minutes: 10, increment: 5 },
  { id: '15+10', label: '15 | 10', minutes: 15, increment: 10 },
  { id: '30', label: '30 min', minutes: 30, increment: 0 },
]

export function timeControl(id: string): TimeControl | null {
  return TIME_CONTROLS.find((t) => t.id === id) ?? null
}

/** "You each have 3 minutes, plus 2 seconds a move." */
export function describeTimeControl(tc: TimeControl): string {
  const minutes = `${tc.minutes} minute${tc.minutes === 1 ? '' : 's'}`
  return `You each have ${minutes}${tc.increment ? `, plus ${tc.increment} seconds a move` : ''}.`
}

type Color = 'white' | 'black'

/** Both sides' time left (ms). The running side's clock started at `since`; null while both are stopped. */
export interface Clock {
  white: number
  black: number
  increment: number
  running: Color | null
  since: number | null
}

export function newClock(tc: TimeControl): Clock {
  const ms = tc.minutes * 60_000
  return { white: ms, black: ms, increment: tc.increment * 1000, running: null, since: null }
}

/** `side`'s time left right now, counting the time it has been running. */
export function timeLeft(clock: Clock, side: Color, now = Date.now()): number {
  const running = clock.running === side && clock.since !== null ? now - clock.since : 0
  return Math.max(0, clock[side] - running)
}

export function startClock(clock: Clock, side: Color): Clock {
  return { ...clock, running: side, since: Date.now() }
}

/** Stop the running clock, charging it the time it ran. */
export function stopClock(clock: Clock): Clock {
  if (!clock.running) return clock
  return { ...clock, [clock.running]: timeLeft(clock, clock.running), running: null, since: null }
}

/** After `side` moves: charge it `spent` ms (for a clock that wasn't running), and add the increment. */
export function afterMove(clock: Clock, side: Color, spent = 0): Clock {
  return { ...clock, [side]: Math.max(0, clock[side] - spent) + clock.increment }
}

/** "4:59", or with tenths under 20 seconds: "0:09.4". */
export function formatClock(ms: number): string {
  const total = Math.max(0, ms)
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const clock = `${minutes}:${String(seconds).padStart(2, '0')}`
  return total < 20_000 ? `${clock}.${Math.floor((total % 1000) / 100)}` : clock
}

/** Whether `color` has too little left to ever checkmate (a lone king, or king and one knight or bishop), in
 * which case running out of time against it is a draw. */
export function cannotMate(game: Chess, color: 'w' | 'b'): boolean {
  const pieces = game
    .board()
    .flat()
    .filter((sq) => sq && sq.color === color && sq.type !== 'k')
  return pieces.length === 0 || (pieces.length === 1 && (pieces[0]!.type === 'n' || pieces[0]!.type === 'b'))
}
