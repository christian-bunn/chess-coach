// Reads coach comments aloud. The audio comes from the backend's voice (Piper) when it has one, and
// plays here as ordinary audio, which works in any browser. The browser's own speech engine is only a
// fallback: some browsers (like the Claude desktop app's) have no voices at all.

const PIECES: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' }

// A move in algebraic notation, optionally with its move number: "12...Nxe4+", "3.d3", "O-O", "exd5", "a8=Q#".
const MOVE = /\b(\d+\.(?:\.\.)?\s*)?(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)([+#])?/g

// Marks the end of a spoken move, so moves that follow each other ("10...Qxd1 11.Raxd1") get a pause between them.
const END = '\u0001'

/**
 * Text as it should be spoken: chess notation turned into words ("12...Nxe4+" -> "knight takes e4, check"),
 * a pause between consecutive moves, and brackets and slashes read the way a person would.
 */
export function speakable(text: string): string {
  const words = text.replace(MOVE, (match, number: string | undefined, san: string, check: string | undefined) => {
    // A bare square ("the pawn on d5") is already fine as it is.
    if (!number && !check && /^[a-h][1-8]$/.test(san)) return match
    let words: string
    if (san === 'O-O') words = 'castling kingside'
    else if (san === 'O-O-O') words = 'castling queenside'
    else {
      const piece = PIECES[san[0]] ?? 'pawn'
      const [, square, promotion] = san.match(/([a-h][1-8])(?:=([QRBN]))?$/) ?? []
      words = `${piece} ${san.includes('x') ? 'takes' : 'to'} ${square}`
      if (promotion) words += `, promoting to a ${PIECES[promotion]}`
    }
    if (check === '+') words += ', check'
    if (check === '#') words += ', checkmate'
    return words + END
  })
  return words
    .replace(new RegExp(`${END}\\s+(?=(?:pawn|knight|bishop|rook|queen|king|castling)\\b)`, 'g'), ', ')
    .replaceAll(END, '')
    .replace(/\s*[()[\]]\s*/g, ', ')
    .replace(/\s*\/\s*/g, ' or ')
    .replace(/\be\.g\.,?/gi, 'for example')
    .replace(/\bi\.e\.,?/gi, 'that is')
    .replace(/\s*,(\s*,)+/g, ',')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
}

let serverVoice = false
let voiceName: string | null = null

/** Tell the voice whether the backend can make speech (from /api/config). */
export function setServerVoice(available: boolean) {
  serverVoice = available
}

/** Which of the backend's voices to use (null: its default). */
export function setVoiceName(name: string | null) {
  voiceName = name
}

function browserHasVoices(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.getVoices().length > 0
}

/** Whether anything can actually be spoken here. */
export function canSpeak(): boolean {
  return serverVoice || browserHasVoices()
}

// Clips waiting to be played, in order (each resolves to an object URL, or null if it failed).
let queue: Promise<string | null>[] = []
let current: HTMLAudioElement | null = null
// Bumped by stopSpeaking(), so anything still loading or playing from before is dropped.
let generation = 0
let loopFor = -1
// How many times a clip paused by something else (the browser, another app taking the audio) is picked up again.
const MAX_RESUMES = 2

async function playQueue(gen: number) {
  while (gen === generation && queue.length > 0) {
    const url = await queue[0]
    if (gen !== generation) {
      if (url) URL.revokeObjectURL(url)
      break
    }
    queue.shift()
    if (!url) continue
    await new Promise<void>((resolve) => {
      const audio = new Audio(url)
      current = audio
      let resumes = 0
      audio.onended = audio.onerror = () => resolve()
      // Only stopSpeaking() (the student's next move) should cut a comment short. A pause from anywhere
      // else used to skip straight to the next comment, so it's resumed instead.
      audio.onpause = () => {
        if (gen !== generation || audio.ended || resumes >= MAX_RESUMES) return resolve()
        resumes++
        console.info('Coach voice: picking up a comment that was paused from outside the page')
        audio.play().catch(() => resolve())
      }
      audio.play().catch(() => resolve())
    })
    current = null
    URL.revokeObjectURL(url)
  }
  if (loopFor === gen) loopFor = -1
}

function fetchClip(text: string): Promise<string | null> {
  return fetch('/api/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: voiceName }),
  })
    .then((response) => (response.ok ? response.blob() : null))
    .then((blob) => (blob ? URL.createObjectURL(blob) : null))
    .catch(() => null)
}

/** Read `text` aloud after anything already being read. */
export function speak(text: string) {
  const words = speakable(text).trim()
  if (!words) return
  if (serverVoice) {
    queue.push(fetchClip(words))
    if (loopFor !== generation) {
      loopFor = generation
      void playQueue(generation)
    }
  } else if (browserHasVoices()) {
    const utterance = new SpeechSynthesisUtterance(words)
    utterance.lang = 'en-US'
    utterance.rate = 1.05
    window.speechSynthesis.speak(utterance)
  }
}

/** Whether anything is being read, or waiting to be read. */
export function speaking(): boolean {
  if (serverVoice) return loopFor !== -1 || queue.length > 0
  return typeof window !== 'undefined' && 'speechSynthesis' in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending)
}

/** Resolves once nothing is being read or waiting to be read: at the latest after `maxMs`, or when `signal` aborts. */
export function whenQuiet(signal?: AbortSignal, maxMs = 30_000): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now()
    const check = () => {
      if (!speaking() || signal?.aborted || Date.now() - started > maxMs) resolve()
      else setTimeout(check, 150)
    }
    check()
  })
}

/** Stop reading, and drop anything queued. */
export function stopSpeaking() {
  generation++
  loopFor = -1 // the old loop just winds down; it mustn't count as still speaking
  for (const pending of queue) void pending.then((url) => url && URL.revokeObjectURL(url))
  queue = []
  current?.pause()
  current = null
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
}
