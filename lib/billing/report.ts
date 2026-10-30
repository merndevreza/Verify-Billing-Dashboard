import * as XLSX from "xlsx"
import type { ParsedTripFile } from "./parse"
import {
  BILLING_COLUMN_HEADERS,
  type BillSummary,
  type BillingRow,
} from "./types"

/**
 * Fallback date display (Excel builtin numFmtId 22) for when the source file
 * carries no per-cell format SheetJS can read. Using a true builtin string
 * matters: custom format strings get written as numFmtIds in Excel's reserved
 * 50–81 range, which Excel renders with East-Asian locale text.
 */
const DEFAULT_DATE_FORMAT = "m/d/yy h:mm"

/**
 * Build the generated billing report: original columns in original order with
 * the updated classification values, plus the billing columns. Numeric
 * billing values are written as numbers; empty ones are skipped so the cells
 * stay blank. Date columns get the number format detected in the source file
 * (or the export's default) so they render as dates, not raw serials.
 * When a summary is provided, a grand-total row is appended under the data.
 */
export function buildBillingWorkbook(
  rows: BillingRow[],
  baseHeaders: string[],
  dateFormats: ParsedTripFile["dateFormats"],
  summary?: BillSummary
): Buffer {
  const header = [...baseHeaders, ...BILLING_COLUMN_HEADERS]
  const ws = XLSX.utils.json_to_sheet(rows, { header })
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1")

  // Grand-total row under the data (only when a summary is provided).
  if (summary) {
    const totalCol = header.indexOf("Price After Penalty")
    const nextRow = range.e.r + 1
    XLSX.utils.sheet_add_aoa(
      ws,
      [[`Grand Total — ${summary.billed} billed trips`]],
      { origin: { r: nextRow, c: range.s.c } }
    )
    if (totalCol >= 0) {
      XLSX.utils.sheet_add_aoa(ws, [[summary.totalAmount]], {
        origin: { r: nextRow, c: totalCol },
      })
    }
  }
  const dateColumns = ["VerificationDateTime", "Receive Date"] as const
  for (const column of dateColumns) {
    const format = dateFormats[column] ?? DEFAULT_DATE_FORMAT
    const c = header.indexOf(column)
    if (c < 0) continue
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && cell.t === "n") cell.z = format
    }
  }

  // Widen the appended columns so distances/audit text are readable on open.
  ws["!cols"] = header.map((name) => {
    if (name === "Compared Branches And Distances") return { wch: 60 }
    if (BILLING_COLUMN_HEADERS.includes(name as (typeof BILLING_COLUMN_HEADERS)[number])) {
      return { wch: 10 }
    }
    return {}
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Billing Report")
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
}

export function billingReportFileName(dateFrom: string, dateTill: string): string {
  return `Billing_Report_${dateFrom}_to_${dateTill}.xlsx`
}
