// Who's playing: their name picks their puzzles, saved games and repertoire on the server (see backend
// players.py). Kept in this browser, so it's only asked for once.

const KEY = 'chess-coach.player'

function load(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

let current = load()

export function currentPlayer(): string | null {
  return current
}

export function choosePlayer(name: string) {
  current = name
  try {
    localStorage.setItem(KEY, name)
  } catch {
    // remembered for this visit only
  }
}

/** Whether `name` can be a player's name: the server keeps its letters and digits. */
export function validName(name: string): boolean {
  return /[\p{L}\p{N}]/u.test(name)
}
