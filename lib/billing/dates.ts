// Timezone-safe calendar date helpers for the TAT calculation.
//
// All comparisons happen on ISO calendar dates ("yyyy-mm-dd") built with UTC
// arithmetic — never on JS Date objects in the host timezone, so a report
// processed on a server in any timezone produces the same TAT Days.

/** Excel serial day 0 = 1899-12-30 (covers the 1900 leap-year bug). */
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30)
const DAY_MS = 86_400_000

function isoFromUTC(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Excel serial number (may carry a time fraction) → ISO calendar date. */
export function serialToISODate(serial: number): string {
  const wholeDays = Math.floor(serial)
  return isoFromUTC(EXCEL_EPOCH_UTC_MS + wholeDays * DAY_MS)
}

/** ISO date → UTC ms at midnight (round-trips with isoFromUTC). */
function isoToUTC(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

export function addISODate(iso: string, days: number): string {
  return isoFromUTC(isoToUTC(iso) + days * DAY_MS)
}

/**
 * Parse a trip-status date cell into an ISO calendar date.
 *
 * Cells arrive either as Excel serial numbers (numeric date cells) or as
 * display strings in the export's `mm-dd-yyyy h:mm:ss AM/PM` format.
 * Returns null when the value is empty/unparseable — callers must treat that
 * as "TAT not computable" rather than guessing.
 */
export function parseCalendarDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return serialToISODate(value)
  }
  if (typeof value !== "string") return null
  const s = value.trim()
  if (!s) return null

  // ISO: 2026-09-01 (optionally followed by a time part)
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`

  // mm-dd-yyyy (or m/d/yyyy), optional time + AM/PM — the export's format
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T].*)?$/.exec(s)
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`

  return null
}

/** Whole calendar days from `fromISO` to `toISO` (to − from). */
export function diffCalendarDays(fromISO: string, toISO: string): number {
  return Math.round((isoToUTC(toISO) - isoToUTC(fromISO)) / DAY_MS)
}

/**
 * Holidays strictly between fromISO and toISO (endpoints excluded — a
 * Receive Date or Verification Date falling on a holiday is NOT subtracted).
 */
export function countHolidaysBetween(
  fromISO: string,
  toISO: string,
  holidays: Set<string>
): number {
  if (holidays.size === 0) return 0
  let count = 0
  for (let d = addISODate(fromISO, 1); d < toISO; d = addISODate(d, 1)) {
    if (holidays.has(d)) count++
  }
  return count
}
