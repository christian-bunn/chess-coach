// Reads coach comments aloud. The audio comes from the backend's voice (Piper) when it has one, and
// plays here as ordinary audio, which works in any browser. The browser's own speech engine is only a
// fallback: some browsers (like the Claude desktop app's) have no voices at all.

const PIECES: Record<string, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' }

// A move in algebraic notation, optionally with its move number: "12...Nxe4+", "3.d3", "O-O", "exd5", "a8=Q#".
const MOVE = /\b(\d+\.(?:\.\.)?\s*)?(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)([+#])?/g

/** Chess notation turned into words a speech engine reads naturally: "12...Nxe4+" -> "knight takes e4, check". */
export function speakable(text: string): string {
  return text.replace(MOVE, (match, number: string | undefined, san: string, check: string | undefined) => {
    // A bare square ("the pawn on d5") is already fine as it is.
    if (!number && !check && /^[a-h][1-8]$/.test(san)) return match
    let words: string
    if (san === 'O-O') words = 'castles kingside'
    else if (san === 'O-O-O') words = 'castles queenside'
    else {
      const piece = PIECES[san[0]] ?? 'pawn'
      const [, square, promotion] = san.match(/([a-h][1-8])(?:=([QRBN]))?$/) ?? []
      words = `${piece} ${san.includes('x') ? 'takes' : 'to'} ${square}`
      if (promotion) words += `, promoting to a ${PIECES[promotion]}`
    }
    if (check === '+') words += ', check'
    if (check === '#') words += ', checkmate'
    return words
  })
}

let serverVoice = false

/** Tell the voice whether the backend can make speech (from /api/config). */
export function setServerVoice(available: boolean) {
  serverVoice = available
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
      audio.onended = audio.onerror = audio.onpause = () => resolve()
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
    body: JSON.stringify({ text }),
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

/** Stop reading, and drop anything queued. */
export function stopSpeaking() {
  generation++
  for (const pending of queue) void pending.then((url) => url && URL.revokeObjectURL(url))
  queue = []
  current?.pause()
  current = null
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
}
