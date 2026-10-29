/**
 * Local-time date helpers. `toISOString()` shifts by timezone, so bill
 * period boundaries are formatted from the local calendar parts instead.
 */

/** Date → local "yyyy-mm-dd". */
export function toISODate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

/** Local "yyyy-mm-dd" → Date at midnight (local). */
export function parseISODate(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

/** Every date from `range.from` to `range.to`, inclusive. */
export function eachDateInRange(range: { from?: Date; to?: Date }): Date[] {
  const dates: Date[] = []
  if (!range.from || !range.to || range.to < range.from) return dates
  const current = new Date(range.from)
  current.setHours(0, 0, 0, 0)
  while (current <= range.to) {
    dates.push(new Date(current))
    current.setDate(current.getDate() + 1)
  }
  return dates
}

/** "2026-02-12" → "12 Feb" (chip label). */
export function formatShortDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })
}

/** Date → "12 Feb 2026" (range button label). */
export function formatFullDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}
