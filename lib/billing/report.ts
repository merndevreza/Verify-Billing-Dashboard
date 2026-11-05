import * as XLSX from "xlsx"
import ExcelJS from "exceljs"
import type { ChunkRecord } from "./chunked-run"
import type { ParsedTripFile } from "./parse"
import {
  BILLING_COLUMN_HEADERS,
  type BillSummary,
  type BillingRow,
} from "./types"
import { ROUTE_UNAVAILABLE_MARKER } from "./calculate"

/**
 * Fallback date display for when the source file carries no per-cell format
 * SheetJS can read. This is NOT an Excel builtin: left alone, the writer
 * assigns custom format strings numFmtIds from Excel's reserved 50–81 range,
 * which Excel replaces with its own locale formats. The string is therefore
 * seeded into a free custom-range id (≥164) before the workbook is written —
 * see the registration in buildBillingWorkbook.
 */
const DEFAULT_DATE_FORMAT = "dd-mm-yyyy hh:mm"
/** Custom numFmtId (≥164 = Excel's free custom range) for DEFAULT_DATE_FORMAT. */
const DEFAULT_DATE_NUMFMT_ID = 164

/** The "Attention Needed" column whose non-empty rows get the yellow fill. */
const ATTENTION_COLUMN = "Attention Needed"
/** Classic yellow for manual-check rows (ARGB). */
const ATTENTION_FILL_COLOR = "FFFFFF00"

/** Mirror of the penalty rule in calculate.ts: 10% per extra TAT day, capped at 100%. */
const MAX_PENALTY_DAYS = 10

/** Run context shown on the summary sheet. */
export interface BillingReportMeta {
  dateFrom: string
  dateTill: string
  /** Org whose branch rules ran — null when the backend verdicts were kept. */
  orgName: string | null
  /** Present when the range was downloaded in ≤maxChunkDays-day chunks. */
  chunks?: ChunkedRunMeta
}

/** Per-chunk download/calculation audit for a chunked run. */
export interface ChunkedRunMeta {
  maxChunkDays: number
  chunkRows: ChunkSheetRow[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** One "Penalties by TAT Extra" row: bucket 0…9 plus a "10+" bucket. */
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

const ROUTE_FAILURE_HEADERS = [
  "DepositId",
  "RefId",
  "District",
  "Thana",
  "Address",
  "Latitude",
  "Longitude",
  "Compared Branches And Distances",
] as const

function buildRouteFailuresSheet(rows: BillingRow[]): XLSX.WorkSheet | null {
  const failed = rows.filter((r) => r.in_out_remote === ROUTE_UNAVAILABLE_MARKER)
  if (failed.length === 0) return null
  const data = failed.map((r) =>
    Object.fromEntries(ROUTE_FAILURE_HEADERS.map((h) => [h, r[h as keyof BillingRow] ?? ""]))
  )
  const ws = XLSX.utils.json_to_sheet(data, { header: [...ROUTE_FAILURE_HEADERS] })
  ws["!cols"] = [
    { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 14 },
    { wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 70 },
  ]
  return ws
}

/** One "Chunk Details" row: what happened to one chunk of the date range. */
export interface ChunkSheetRow {
  chunk: number
  dateFrom: string
  dateTill: string
  days: number
  apiSuccess: boolean
  retriesUsed: number
  httpStatus: number | string
  responseBytes: number
  rowCount: number
  billCalculated: boolean
  calcDurationMs: number | null
  comment: string
}

/** Map a chunked run's records onto "Chunk Details" sheet rows. */
export function chunkSheetRows(chunks: ChunkRecord[]): ChunkSheetRow[] {
  return chunks.map(({ download, calculation }) => {
    let comment = "OK"
    if (!download.success) {
      comment = download.error ?? "Download failed"
    } else if (!calculation.calculated) {
      comment = calculation.error ?? "Calculation failed"
    } else if (download.rowCount === 0) {
      comment = "OK (empty)"
    } else if (download.retriesUsed > 0) {
      comment = `OK (${download.retriesUsed} retr${download.retriesUsed === 1 ? "y" : "ies"})`
    }
    return {
      chunk: download.index,
      dateFrom: download.dateFrom,
      dateTill: download.dateTill,
      days: download.days,
      apiSuccess: download.success,
      retriesUsed: download.retriesUsed,
      httpStatus: download.httpStatus,
      responseBytes: download.responseBytes,
      rowCount: download.rowCount,
      billCalculated: calculation.calculated,
      calcDurationMs: calculation.durationMs,
      comment,
    }
  })
}

const CHUNK_DETAIL_HEADERS = [
  "Chunk #",
  "Date From",
  "Date Till",
  "Days",
  "API Success",
  "Retries Used",
  "HTTP/Envelope Status",
  "Response Length (bytes)",
  "Row Count",
  "Bill Calculated",
  "Calc Duration (s)",
  "Comment",
] as const

/**
 * Audit page for the chunked download: one row per chunk of the date range —
 * what was requested, whether the API call succeeded (and after how many
 * retries), how big the response was, whether the bill was calculated from
 * it, and a comment carrying any failure message.
 */
function buildChunkDetailsSheet(rows: ChunkSheetRow[]): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [
    [...CHUNK_DETAIL_HEADERS],
    ...rows.map(
      (r) =>
        [
          r.chunk,
          r.dateFrom,
          r.dateTill,
          r.days,
          r.apiSuccess ? "Yes" : "No",
          r.retriesUsed,
          String(r.httpStatus),
          r.responseBytes,
          r.rowCount,
          r.billCalculated ? "Yes" : "No",
          r.calcDurationMs === null ? "" : round2(r.calcDurationMs / 1000),
          r.comment,
        ] as (string | number)[]
    ),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws["!cols"] = [
    { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 6 }, { wch: 11 },
    { wch: 12 }, { wch: 20 }, { wch: 22 }, { wch: 10 }, { wch: 14 },
    { wch: 15 }, { wch: 60 },
  ]
  return ws
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
    // How the backend download was split (chunked runs only).
    ...(meta.chunks
      ? [["Chunks", `${meta.chunks.chunkRows.length} × ≤${meta.chunks.maxChunkDays} days`]]
      : []),
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
 * The three date columns, side by side in this exact order, placed
 * immediately before in_out_remote. api_submission_time is dropped from the
 * report — its data lives on as the Submission Date column.
 */
const DATE_COLUMNS = [
  "Receive Date",
  "VerificationDateTime",
  "Submission Date",
] as const

/**
 * SheetJS community edition cannot write cell styles, so the yellow
 * manual-check highlighting is applied in a second pass: ExcelJS re-reads the
 * SheetJS-built workbook and solid-fills every "Billing Report" row whose
 * "Attention Needed" cell is non-empty. Values and date formats survive the
 * round trip.
 */
async function highlightAttentionRows(buffer: Buffer): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  const ws = workbook.getWorksheet("Billing Report")
  if (!ws) return buffer

  // Locate the attention column in the header row.
  let attentionCol = 0
  ws.getRow(1).eachCell((cell, colNumber) => {
    if (String(cell.value ?? "").trim() === ATTENTION_COLUMN) {
      attentionCol = colNumber
    }
  })
  if (!attentionCol) return buffer

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const flag = row.getCell(attentionCol)
    if (typeof flag.value === "string" && flag.value.trim() !== "") {
      row.eachCell({ includeEmpty: true }, (cell) => {
        // Replace the whole style object rather than assigning cell.fill —
        // loaded cells can share one style record, and mutating .fill would
        // leak the highlight onto unflagged rows (verified: date-formatted
        // cells share numFmt styles across rows).
        cell.style = {
          ...cell.style,
          fill: {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: ATTENTION_FILL_COLOR },
          },
        }
      })
    }
  }
  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer)
}

/**
 * Build the generated billing report: the original columns with the three
 * date columns side by side immediately before in_out_remote (and
 * api_submission_time dropped), plus the billing columns (ending in
 * "Attention Needed"), and a "Billing Summary" sheet in front. Numeric
 * billing values are written as numbers; empty ones are skipped so the cells
 * stay blank. The three date columns get the same number format (the one
 * detected in the source file, or the export's default) so they render
 * identically. A grand-total row is appended under the data. Rows flagged in
 * "Attention Needed" (hybrid-estimated distances) are highlighted yellow.
 */
export async function buildBillingWorkbook(
  rows: BillingRow[],
  baseHeaders: string[],
  dateFormats: ParsedTripFile["dateFormats"],
  summary: BillSummary,
  meta: BillingReportMeta
): Promise<Buffer> {
  const header: string[] = []
  let datesPlaced = false
  for (const name of baseHeaders) {
    // Backend's raw submission column — superseded by "Submission Date".
    if (name === "api_submission_time") continue
    if (DATE_COLUMNS.includes(name as (typeof DATE_COLUMNS)[number])) continue
    if (name === "in_out_remote" && !datesPlaced) {
      header.push(...DATE_COLUMNS)
      datesPlaced = true
    }
    header.push(name)
  }
  if (!datesPlaced) header.push(...DATE_COLUMNS)
  header.push(...BILLING_COLUMN_HEADERS)
  // json_to_sheet appends any row key missing from header as a trailing
  // column, so api_submission_time must be stripped from the rows too.
  const reportRows = rows.map(({ api_submission_time: _raw, ...rest }) => rest)
  const ws = XLSX.utils.json_to_sheet(reportRows, { header })
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
  // One shared number format for all three date columns so they render
  // identically and can be compared side by side.
  for (const column of DATE_COLUMNS) {
    const format = dateFormats[column] ?? DEFAULT_DATE_FORMAT
    const c = header.indexOf(column)
    if (c < 0) continue
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && cell.t === "n") cell.z = format
    }
  }

  // Widen the date and appended columns so dates/audit text are readable on
  // open.
  ws["!cols"] = header.map((name) => {
    if (DATE_COLUMNS.includes(name as (typeof DATE_COLUMNS)[number])) {
      return { wch: 16 }
    }
    if (name === "Compared Branches And Distances") return { wch: 60 }
    if (name === ATTENTION_COLUMN) return { wch: 90 }
    if (BILLING_COLUMN_HEADERS.includes(name as (typeof BILLING_COLUMN_HEADERS)[number])) {
      return { wch: 10 }
    }
    return {}
  })

  // Register the custom date format in Excel's free custom numFmtId range so
  // the writer emits a real <numFmt> instead of a reserved builtin id (which
  // Excel renders with its own locale format — see DEFAULT_DATE_FORMAT).
  XLSX.SSF._table[DEFAULT_DATE_NUMFMT_ID] = DEFAULT_DATE_FORMAT
  const wb = XLSX.utils.book_new()
  // Summary first — it is the sheet finance opens.
  XLSX.utils.book_append_sheet(
    wb,
    buildSummarySheet(summary, meta, penaltyBreakdown(rows)),
    "Billing Summary"
  )
  XLSX.utils.book_append_sheet(wb, ws, "Billing Report")
  const routeFailuresSheet = buildRouteFailuresSheet(rows)
  if (routeFailuresSheet) {
    XLSX.utils.book_append_sheet(wb, routeFailuresSheet, "Route Failures")
  }
  // Always last — the chunked-download audit trail ships even when every
  // chunk succeeded, so the bill's provenance lives on the file itself.
  XLSX.utils.book_append_sheet(
    wb,
    buildChunkDetailsSheet(meta.chunks?.chunkRows ?? []),
    "Chunk Details"
  )
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
  // Yellow-fill the manual-check rows — SheetJS alone cannot write styles.
  return highlightAttentionRows(buffer)
}

export function billingReportFileName(dateFrom: string, dateTill: string): string {
  return `Billing_Report_${dateFrom}_to_${dateTill}.xlsx`
}
