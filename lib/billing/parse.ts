import * as XLSX from "xlsx"
import type { TripStatusRow } from "./types"

/** Columns the export must contain; a missing one means the file is not what we expect. */
export const REQUIRED_COLUMNS = ["DepositId", "RefId", "in_out_remote"] as const

/**
 * Parse the downloaded export into row objects. SheetJS sniffs the real
 * format from the bytes, so a true .xls (BIFF), an .xlsx, or an HTML/CSV
 * table saved with an .xls extension all work.
 */
export function parseTripStatusFile(buffer: Buffer): TripStatusRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error("The downloaded file has no sheets")

  const rows = XLSX.utils.sheet_to_json<TripStatusRow>(
    workbook.Sheets[sheetName],
    { defval: "" }
  )

  if (rows.length > 0) {
    const missing = REQUIRED_COLUMNS.filter((c) => !(c in rows[0]))
    if (missing.length > 0) {
      throw new Error(
        `The downloaded file is missing expected column(s): ${missing.join(", ")}`
      )
    }
  }
  return rows
}