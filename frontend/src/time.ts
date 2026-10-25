/** When something is due, from now: "now", "in under an hour", "in 5 hours", "tomorrow", "in 3 days". */
export function fromNow(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'now'
  const hours = Math.round(ms / 3_600_000)
  if (hours < 1) return 'in under an hour'
  if (hours < 20) return `in ${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.max(1, Math.round(hours / 24))
  return days === 1 ? 'tomorrow' : `in ${days} days`
}
