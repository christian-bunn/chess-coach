// Reads coach comments aloud with the browser's built-in speech engine (free, offline, no setup).

export const voiceSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

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

/** Read `text` aloud after anything already being read. */
export function speak(text: string) {
  if (!voiceSupported || !text.trim()) return
  const utterance = new SpeechSynthesisUtterance(speakable(text))
  utterance.lang = 'en-US'
  utterance.rate = 1.05
  window.speechSynthesis.speak(utterance)
}

/** Stop reading, and drop anything queued. */
export function stopSpeaking() {
  if (voiceSupported) window.speechSynthesis.cancel()
}
