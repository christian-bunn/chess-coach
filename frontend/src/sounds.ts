// The board's sounds: the piece going down, a take, a check. One short recording each, in
// frontend/public/sounds (see README, "Board sounds"), played through the Web Audio API rather than <audio>
// elements so a sound lands the moment its move does and two can overlap without cutting each other off.

import { Chess, type Square } from 'chess.js'

const KEY = 'chess-coach.sounds'
// Under the coach's voice, which has more to say than a knock does.
const LEVEL = 0.8

export type Sound = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'start' | 'end'

const FILES: Record<Sound, string> = {
  move: 'move-self',
  capture: 'capture',
  check: 'move-check',
  castle: 'castle',
  promote: 'promote',
  start: 'game-start',
  end: 'game-end',
}

/** What a move was, for the sound it makes. */
export interface Played {
  kind: 'move' | 'capture' | 'castle' | 'promote'
  check: boolean
  /** Checkmate, stalemate or any other finish on the board. */
  end: boolean
}

let on = load()
let context: AudioContext | null = null
let master: GainNode | null = null
const downloaded = new Map<Sound, Promise<ArrayBuffer>>()
const ready = new Map<Sound, Promise<AudioBuffer>>()

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

/** Fetch the files up front: 50 kB in total, so the first move doesn't wait on the network. */
function download() {
  for (const sound of Object.keys(FILES) as Sound[]) {
    if (!downloaded.has(sound)) {
      downloaded.set(
        sound,
        fetch(`/sounds/${FILES[sound]}.mp3`).then((response) => {
          if (!response.ok) throw new Error(`${response.status}`)
          return response.arrayBuffer()
        }),
      )
    }
  }
}

export function soundsOn(): boolean {
  return on
}

export function setSoundsOn(next: boolean) {
  on = next
  try {
    localStorage.setItem(KEY, next ? 'on' : 'off')
  } catch {
    // this visit only
  }
  if (next) {
    download()
    play('move') // so you hear what you've just turned on
  }
}

function audio(): GainNode | null {
  if (!on) return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!context || !master) {
    context = new Ctor()
    master = context.createGain()
    master.gain.value = LEVEL
    master.connect(context.destination)
  }
  // Browsers hold a new context suspended until a gesture; the first sound follows a click, so this takes.
  if (context.state === 'suspended') void context.resume()
  return master
}

/** Decoding is kept as the promise, so two moves in quick succession can't decode the same bytes twice. */
function decode(sound: Sound, ctx: AudioContext): Promise<AudioBuffer> {
  if (!ready.has(sound)) {
    download()
    // decodeAudioData takes the bytes for itself, so it gets a copy and the original stays reusable.
    ready.set(sound, downloaded.get(sound)!.then((bytes) => ctx.decodeAudioData(bytes.slice(0))))
  }
  return ready.get(sound)!
}

export function play(sound: Sound) {
  const out = audio()
  if (!out || !context) return
  const ctx = context
  decode(sound, ctx).then(
    (buffer) => {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(out)
      source.start()
    },
    () => {
      // A sound that won't load or decode is not worth interrupting the game over.
    },
  )
}

const FILES_ORDER = 'abcdefgh'

/**
 * What the move from `before` to the position now on the board was. `before` is the FEN it was played from, so
 * this works out a capture (including en passant), a castle and a promotion without being told.
 */
export function describe(before: string, after: Chess, from: string, to: string): Played | null {
  let board: Chess
  try {
    board = new Chess(before)
  } catch {
    return null // not a position we can read: say nothing rather than guess
  }
  const moving = board.get(from as Square)
  if (!moving) return null
  const sideways = FILES_ORDER.indexOf(from[0]) !== FILES_ORDER.indexOf(to[0])
  const kind: Played['kind'] =
    moving.type === 'k' && Math.abs(FILES_ORDER.indexOf(from[0]) - FILES_ORDER.indexOf(to[0])) > 1
      ? 'castle'
      : moving.type === 'p' && (to[1] === '8' || to[1] === '1')
        ? 'promote'
        : // A pawn going sideways onto an empty square has taken en passant.
          board.get(to as Square) || (moving.type === 'p' && sideways)
          ? 'capture'
          : 'move'
  return { kind, check: after.inCheck(), end: after.isGameOver() }
}

/** The end of the game speaks over everything; a check over what kind of move it was. */
export function soundFor(played: Played): Sound {
  if (played.end) return 'end'
  if (played.check) return 'check'
  return played.kind === 'move' ? 'move' : played.kind
}

/** The sound for a move that has just appeared on the board. */
export function playMove(before: string, after: Chess, from: string, to: string) {
  if (!on) return
  const played = describe(before, after, from, to)
  if (played) play(soundFor(played))
}

if (on) download()
