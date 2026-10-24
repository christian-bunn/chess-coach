import { useCallback, useEffect, useState } from 'react'
import { api, type SavedGameSummary } from './api'
import { accuracy, openingOf, sideGrades } from './review'
import type { Assistance, ReviewSnapshot } from './useCoachGame'

export interface OpenGame {
  summary: SavedGameSummary
  review: ReviewSnapshot
}

/** Games saved from the review, to look at again later (kept by the backend, in progress/games.json). */
export function useSavedGames() {
  const [games, setGames] = useState<SavedGameSummary[] | null>(null)
  const [open, setOpen] = useState<OpenGame | null>(null)

  const refresh = useCallback(() => {
    api.games.list().then(setGames, () => setGames([]))
  }, [])
  useEffect(refresh, [refresh])

  /** Save a game from its review. Returns the saved game's id. */
  const save = async (review: ReviewSnapshot, opponent: string | null, assistance: Assistance): Promise<string> => {
    const mine = accuracy(sideGrades(review, true))
    const theirs = accuracy(sideGrades(review, false))
    const { id } = await api.games.save({
      snapshot: review,
      color: review.userColor,
      result: review.result,
      opponent,
      assistance,
      opening: openingOf(review.plies)?.name ?? null,
      accuracy: mine === null ? null : Math.round(mine * 10) / 10,
      opponent_accuracy: theirs === null ? null : Math.round(theirs * 10) / 10,
    })
    refresh()
    return id
  }

  const show = async (id: string) => {
    const { snapshot, ...summary } = await api.games.get<ReviewSnapshot>(id)
    setOpen({ summary, review: snapshot })
  }

  const remove = async (id: string) => {
    await api.games.remove(id)
    if (open?.summary.id === id) setOpen(null)
    refresh()
  }

  return { games, open, refresh, save, show, close: () => setOpen(null), remove }
}
