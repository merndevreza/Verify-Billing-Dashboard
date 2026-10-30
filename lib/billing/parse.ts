import * as XLSX from "xlsx"
import type { TripStatusRow } from "./types"

/** Columns the calculation depends on; a missing one means the file is not what we expect. */
export const REQUIRED_COLUMNS = [
  "DepositId",
  "RefId",
  "Latitude",
  "Longitude",
  "VerificationDateTime",
  "Receive Date",
  "District",
  "Address",
  "in_out_remote",
] as const

/** Fallback column order (matches the export) when the file has no data rows. */
export const TRIP_STATUS_COLUMNS = [
  "DepositId",
  "RefId",
  "VerificationTypeName",
  "VerificationStatus",
  "ContactPerson",
  "ContactPersonsDesignation",
  "OwnerNameStatus",
  "NatureOfBusiness",
  "SignBoardStatus",
  "NatureOfBusinessStatus",
  "MobileVerificationStatus",
  "Relation",
  "Comments",
  "Remarks",
  "Latitude",
  "Longitude",
  "VerificationDateTime",
  "ResidenceType",
  "StayOfDuration",
  "Address",
  "Receive Date",
  "InsideDhakaMetro",
  "AddressApproachStatus",
  "District",
  "Thana",
  "in_out_remote",
  "ApplicationStatus",
] as const

export interface ParsedTripFile {
  rows: TripStatusRow[]
  /** Excel number format detected per date column, reused on the output file. */
  dateFormats: Partial<Record<"VerificationDateTime" | "Receive Date", string>>
}

/** Header cells for one column, read directly off the sheet (no full AOA copy). */
function* columnCells(
  ws: XLSX.WorkSheet,
  colIndex: number,
  firstRow: number,
  lastRow: number
) {
  for (let r = firstRow; r <= lastRow; r++) {
    yield ws[XLSX.utils.encode_cell({ r, c: colIndex })]
  }
}

/**
 * Parse the downloaded export into row objects. SheetJS sniffs the real
 * format from the bytes, so a true .xls (BIFF), an .xlsx, or an HTML/CSV
 * table saved with an .xls extension all work.
 *
 * Date cells stay as Excel serial numbers (cellDates is NOT enabled) so the
 * original numeric values can round-trip into the output file with their
 * number format intact.
 */
export function parseTripStatusFile(buffer: Buffer): ParsedTripFile {
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error("The downloaded file has no sheets")
  const ws = workbook.Sheets[sheetName]

  const rows = XLSX.utils.sheet_to_json<TripStatusRow>(ws, { defval: "" })

  const dateColumns: ("VerificationDateTime" | "Receive Date")[] = [
    "VerificationDateTime",
    "Receive Date",
  ]
  const dateFormats: ParsedTripFile["dateFormats"] = {}

  if (rows.length > 0) {
    const missing = REQUIRED_COLUMNS.filter((c) => !(c in rows[0]))
    if (missing.length > 0) {
      throw new Error(
        `The downloaded file is missing expected column(s): ${missing.join(", ")}`
      )
    }
  }

  // Detect each date column's number format from its first formatted cell so
  // the generated report displays dates like the original download.
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1")
  const headerToIndex = new Map<string, number>()
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })]
    if (cell && cell.v !== undefined) headerToIndex.set(String(cell.v), c)
  }
  for (const col of dateColumns) {
    const idx = headerToIndex.get(col)
    if (idx === undefined) continue
    for (const cell of columnCells(ws, idx, range.s.r + 1, range.e.r)) {
      if (cell && typeof cell.v === "number" && cell.z) {
        dateFormats[col] = String(cell.z)
        break
      }
    }
  }

  return { rows, dateFormats }
}
