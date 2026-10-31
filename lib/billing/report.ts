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

/** Mirror of the penalty ladder length in calculate.ts (day1…day7). */
const MAX_PENALTY_DAYS = 7

/** Run context shown on the summary sheet. */
export interface BillingReportMeta {
  dateFrom: string
  dateTill: string
  /** Org whose branch rules ran — null when the backend verdicts were kept. */
  orgName: string | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** One "Penalties by TAT Extra" row: bucket 0…6 plus a "7+" bucket. */
interface PenaltyBucket {
  label: string
  trips: number
  penaltyPercent: number | null
  rateTotal: number
  penaltyAmount: number
}

/**
 * Aggregate the billed rows by TAT Extra. All rows in a bucket share the same
 * penalty percent (it is a pure function of extra days); the amount is the
 * discount off the rate, so the buckets sum to rateTotal − totalAmount.
 */
function penaltyBreakdown(rows: BillingRow[]): PenaltyBucket[] {
  const buckets: PenaltyBucket[] = Array.from(
    { length: MAX_PENALTY_DAYS + 1 },
    (_, extra) => ({
      label: extra < MAX_PENALTY_DAYS ? String(extra) : `${MAX_PENALTY_DAYS}+`,
      trips: 0,
      penaltyPercent: null,
      rateTotal: 0,
      penaltyAmount: 0,
    })
  )
  for (const row of rows) {
    const extra = row["TAT Extra"]
    const rate = row["Rate"]
    const price = row["Price After Penalty"]
    if (typeof extra !== "number" || typeof rate !== "number") continue
    const bucket = buckets[Math.min(extra, MAX_PENALTY_DAYS)]
    bucket.trips++
    bucket.rateTotal += rate
    if (bucket.penaltyPercent === null) bucket.penaltyPercent = row["Penalty"]
    if (typeof price === "number") bucket.penaltyAmount += rate - price
  }
  for (const bucket of buckets) {
    bucket.rateTotal = round2(bucket.rateTotal)
    bucket.penaltyAmount = round2(bucket.penaltyAmount)
  }
  return buckets
}

/**
 * Human-facing first sheet: run context, totals, classification, not-billed
 * reasons and the penalty breakdown. Written as a plain AOA so it reads like
 * a report page rather than a data grid.
 */
function buildSummarySheet(
  summary: BillSummary,
  meta: BillingReportMeta,
  buckets: PenaltyBucket[]
): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [
    ["Billing Summary"],
    [],
    ["Organization", meta.orgName ?? "— (backend classification kept)"],
    ["Billing Period", `${meta.dateFrom} to ${meta.dateTill}`],
    ["Generated", `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`],
    [],
    ["Trips"],
    ["Total Trips", summary.totalRows],
    ["Billed Trips", summary.billed],
    ["Total Amount (Tk)", summary.totalAmount],
    [],
    ["Classification"],
    ["IN", summary.classification.in],
    ["OUT", summary.classification.out],
    ["REMOTE", summary.classification.remote],
    [],
    ["Not Billed"],
    ["Route distance unavailable", summary.routeUnavailable],
    ["Invalid coordinates", summary.invalidCoordinates],
    ["TAT unavailable", summary.tatUnavailable],
    ["Unclassified", summary.unclassified],
    [],
    ["Penalties by TAT Extra"],
    ["TAT Extra", "Trips", "Penalty %", "Rate Total (Tk)", "Penalty Amount (Tk)"],
    ...buckets.map(
      (b) =>
        [
          b.label,
          b.trips,
          b.penaltyPercent ?? "",
          b.trips > 0 ? b.rateTotal : "",
          b.trips > 0 ? b.penaltyAmount : "",
        ] as (string | number)[]
    ),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws["!cols"] = [{ wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 19 }]
  return ws
}

/**
 * Build the generated billing report: original columns in original order with
 * the updated classification values, plus the billing columns, and a
 * "Billing Summary" sheet in front. Numeric billing values are written as
 * numbers; empty ones are skipped so the cells stay blank. Date columns get
 * the number format detected in the source file (or the export's default) so
 * they render as dates, not raw serials. A grand-total row is appended under
 * the data.
 */
export function buildBillingWorkbook(
  rows: BillingRow[],
  baseHeaders: string[],
  dateFormats: ParsedTripFile["dateFormats"],
  summary: BillSummary,
  meta: BillingReportMeta
): Buffer {
  const header = [...baseHeaders, ...BILLING_COLUMN_HEADERS]
  const ws = XLSX.utils.json_to_sheet(rows, { header })
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1")

  // Grand-total row under the data.
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
  // Summary first — it is the sheet finance opens.
  XLSX.utils.book_append_sheet(
    wb,
    buildSummarySheet(summary, meta, penaltyBreakdown(rows)),
    "Billing Summary"
  )
  XLSX.utils.book_append_sheet(wb, ws, "Billing Report")
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
}

export function billingReportFileName(dateFrom: string, dateTill: string): string {
  return `Billing_Report_${dateFrom}_to_${dateTill}.xlsx`
}
