// ============================================================================
// Chunked sla-status download + pipelined bill calculation — server-only.
//
// The backend sla-status report fails on full-month date ranges, so the range
// is split into windows of at most MAX_CHUNK_DAYS days (the last one carries
// whatever remains, 1–MAX_CHUNK_DAYS days) and downloaded STRICTLY one at a
// time — the next chunk starts only after the previous one finished, so the
// chunking never hammers the backend with parallel requests.
//
// Each chunk's raw response is archived (source-chunk-NN.json) and its bill
// calculation is chained to start immediately, overlapping the NEXT chunk's
// download while never running two processBilling calls at once.
//
// Any permanently failed chunk — download after retries, unparseable
// response, or a calculation error — aborts the whole run: chunks.json
// records exactly what happened, and the route handler answers with an error
// naming the failing chunk. No partial bill file is ever produced.
// ============================================================================

import { ApiErrorClass } from "@/lib/api/fetcher"
import { serverAPI, type TripStatusRequest } from "@/lib/api/server"
import type { CalculateBillPayload } from "@/lib/types/billing"
import { processBilling, type BillingParams } from "./calculate"
import { addISODate, diffCalendarDays } from "./dates"
import { parseSlaStatusResponse, type ParsedTripFile } from "./parse"
import { saveRunFile } from "./storage"
import type { BillSummary, BillingRow } from "./types"

/** Largest date range a single sla-status request may cover, in days. */
export const MAX_CHUNK_DAYS = 5
/** Transient download failures get this many retries after the first attempt. */
const DOWNLOAD_RETRIES = 2
/** Backoff before retry 1 and retry 2. */
const RETRY_DELAYS_MS = [2_000, 5_000]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** One inclusive slice of the requested date range. Chunk numbers are 1-based. */
export interface ChunkWindow {
  index: number
  dateFrom: string
  dateTill: string
  days: number
}

export interface ChunkDownloadInfo {
  index: number
  dateFrom: string
  dateTill: string
  days: number
  success: boolean
  retriesUsed: number
  /** Envelope HTTP status, or "network" / "timeout" when the request never answered. */
  httpStatus: number | string
  responseBytes: number
  rowCount: number
  error: string | null
}

export interface ChunkCalcInfo {
  index: number
  calculated: boolean
  durationMs: number | null
  error: string | null
}

export interface ChunkRecord {
  download: ChunkDownloadInfo
  calculation: ChunkCalcInfo
}

export interface ChunkFailureDetail {
  index: number
  dateFrom: string
  dateTill: string
}

/** Thrown by runChunkedBilling when a chunk fails permanently. */
export class ChunkFailureError extends Error {
  constructor(
    readonly chunk: ChunkFailureDetail,
    readonly phase: "download" | "parse" | "calculation",
    readonly attempts: number,
    /** chunks.json location — the route echoes it so audits can find the run. */
    readonly manifestFile: string,
    cause: unknown
  ) {
    super(chunkFailureMessage(chunk, phase, attempts, cause))
    this.name = "ChunkFailureError"
  }
}

function chunkFailureMessage(
  chunk: ChunkFailureDetail,
  phase: ChunkFailureError["phase"],
  attempts: number,
  cause: unknown
): string {
  const label = `Chunk ${chunk.index} (${chunk.dateFrom} to ${chunk.dateTill})`
  const reason = errMessage(cause)
  if (phase === "download") {
    return `${label} failed to download after ${attempts} attempt(s): ${reason}`
  }
  if (phase === "parse") {
    return `${label} returned a response that could not be parsed: ${reason}`
  }
  return `${label} failed during bill calculation: ${reason}`
}

/**
 * Split an inclusive date range into consecutive windows of at most maxDays
 * days — no gaps, no overlaps (the cursor always jumps to the day after the
 * previous window's last day).
 */
export function chunkDateRange(
  dateFrom: string,
  dateTill: string,
  maxDays = MAX_CHUNK_DAYS
): ChunkWindow[] {
  if (dateFrom > dateTill || maxDays < 1) return []
  const windows: ChunkWindow[] = []
  let from = dateFrom
  let index = 1
  while (from <= dateTill) {
    let till = addISODate(from, maxDays - 1)
    if (till > dateTill) till = dateTill
    windows.push({
      index,
      dateFrom: from,
      dateTill: till,
      days: diffCalendarDays(from, till) + 1,
    })
    from = addISODate(till, 1)
    index++
  }
  return windows
}

/**
 * Combine the per-chunk summaries into one. Every BillSummary field is a
 * plain count (or an amount), so an additive merge is exact.
 */
export function mergeSummaries(summaries: BillSummary[]): BillSummary {
  const merged: BillSummary = {
    totalRows: 0,
    billed: 0,
    classification: { in: 0, out: 0, remote: 0 },
    invalidCoordinates: 0,
    tatUnavailable: 0,
    submissionMissing: 0,
    unclassified: 0,
    totalAmount: 0,
  }
  for (const s of summaries) {
    merged.totalRows += s.totalRows
    merged.billed += s.billed
    merged.classification.in += s.classification.in
    merged.classification.out += s.classification.out
    merged.classification.remote += s.classification.remote
    merged.invalidCoordinates += s.invalidCoordinates
    merged.tatUnavailable += s.tatUnavailable
    merged.submissionMissing += s.submissionMissing
    merged.unclassified += s.unclassified
    merged.totalAmount += s.totalAmount
  }
  merged.totalAmount = round2(merged.totalAmount)
  return merged
}

function errMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err)
}

/** True for deterministic 4xx errors (auth/validation) — retrying cannot help. */
function isClientError(err: unknown): boolean {
  return (
    err instanceof ApiErrorClass &&
    typeof err.status === "number" &&
    err.status >= 400 &&
    err.status < 500
  )
}

/** How a request failed, for the details sheet's status column. */
function failureStatus(err: unknown): number | string {
  if (err instanceof ApiErrorClass && typeof err.status === "number") {
    return err.status
  }
  // AbortSignal.timeout rejects the fetch with DOMException("TimeoutError").
  if (err instanceof Error && err.name === "TimeoutError") return "timeout"
  if (err instanceof TypeError) return "network" // fetch-level failure
  return "error"
}

/**
 * One chunk download: 1 attempt + DOWNLOAD_RETRIES on transient failures
 * (network, timeout, 5xx, non-200 envelope). Client errors fail immediately.
 */
async function fetchSlaStatusWithRetry(
  body: TripStatusRequest,
  token?: string
): Promise<{ json: unknown; retriesUsed: number; httpStatus: number }> {
  let lastError: unknown
  for (let attempt = 0; attempt <= DOWNLOAD_RETRIES; attempt++) {
    try {
      const json = await serverAPI.billing.fetchSlaStatus(body, token)
      return { json, retriesUsed: attempt, httpStatus: 200 }
    } catch (err) {
      lastError = err
      if (isClientError(err)) throw err
      if (attempt < DOWNLOAD_RETRIES) await sleep(RETRY_DELAYS_MS[attempt])
    }
  }
  throw lastError
}

export interface RunChunkedBillingOptions {
  payload: CalculateBillPayload
  /** Bearer token from the incoming request; falls back to the session. */
  token?: string
  runId: string
  /** Rates/holidays/isochrones for processBilling — resolved once by the route. */
  onParams: () => BillingParams
}

export interface ChunkedRunResult {
  /** All billed rows, concatenated in chunk order. */
  rows: BillingRow[]
  /** Additive merge of the per-chunk summaries. */
  summary: BillSummary
  /** Per-chunk download/calculation audit records, in chunk order. */
  chunks: ChunkRecord[]
  totalChunks: number
}

interface ChunkManifest {
  request: CalculateBillPayload
  maxChunkDays: number
  totalChunks: number
  aborted: { index: number; phase: string; error: string } | null
  chunks: ChunkRecord[]
}

/**
 * Download the payload's date range in ≤MAX_CHUNK_DAYS-day chunks (strictly
 * sequentially) and bill each chunk as soon as its download lands. Throws
 * ChunkFailureError when any chunk fails permanently.
 */
export async function runChunkedBilling(
  opts: RunChunkedBillingOptions
): Promise<ChunkedRunResult> {
  const { payload, token, runId } = opts
  const windows = chunkDateRange(payload.dateFrom, payload.dateTill, MAX_CHUNK_DAYS)
  const params = opts.onParams()

  // The maps for the calculating part: downloads/calculations by chunk index
  // (for the manifest and the details sheet), rows/summaries by chunk index
  // (merged once every chunk has been calculated).
  const downloads = new Map<number, ChunkDownloadInfo>()
  const calculations = new Map<number, ChunkCalcInfo>()
  const rowsByChunk = new Map<number, BillingRow[]>()
  const summariesByChunk = new Map<number, BillSummary>()

  const records = (): ChunkRecord[] =>
    [...downloads.keys()].sort((a, b) => a - b).map((index) => ({
      download: downloads.get(index)!,
      calculation:
        calculations.get(index) ?? {
          index,
          calculated: false,
          durationMs: null,
          error: "Not calculated",
        },
    }))

  const writeManifest = (aborted: ChunkManifest["aborted"]) =>
    saveRunFile(
      runId,
      "chunks.json",
      JSON.stringify(
        {
          request: payload,
          maxChunkDays: MAX_CHUNK_DAYS,
          totalChunks: windows.length,
          aborted,
          chunks: records(),
        },
        null,
        2
      )
    )

  const abort = async (
    window: ChunkWindow,
    phase: "download" | "parse" | "calculation",
    error: unknown,
    attempts: number
  ): Promise<never> => {
    const manifestFile = await writeManifest({
      index: window.index,
      phase,
      error: errMessage(error),
    })
    throw new ChunkFailureError(
      {
        index: window.index,
        dateFrom: window.dateFrom,
        dateTill: window.dateTill,
      },
      phase,
      attempts,
      manifestFile,
      error
    )
  }

  // Calculation chain: each chunk's processBilling is appended to the chain,
  // so at most one runs at a time while the next download proceeds. The
  // failure is collected in a const array — the closure must not reassign a
  // flag variable, or narrowing would hide it after the chain is awaited.
  let calcChain: Promise<void> = Promise.resolve()
  const calcFailures: { index: number; error: unknown }[] = []

  for (const window of windows) {
    // A chunk already failed to calculate — pulling more data is pointless.
    if (calcFailures.length > 0) break

    const body: TripStatusRequest = {
      dateFrom: window.dateFrom,
      dateTill: window.dateTill,
      page: payload.page ?? 1,
      org_id: payload.org_id,
      status: payload.status,
    }

    // 1. Download this chunk.
    let fetched: { json: unknown; retriesUsed: number; httpStatus: number }
    try {
      fetched = await fetchSlaStatusWithRetry(body, token)
    } catch (err) {
      downloads.set(window.index, {
        index: window.index,
        dateFrom: window.dateFrom,
        dateTill: window.dateTill,
        days: window.days,
        success: false,
        retriesUsed: DOWNLOAD_RETRIES,
        httpStatus: failureStatus(err),
        responseBytes: 0,
        rowCount: 0,
        error: errMessage(err),
      })
      // The abort always throws; the return keeps "fetched" definitely
      // assigned for the control-flow analysis.
      return await abort(window, "download", err, DOWNLOAD_RETRIES + 1)
    }

    // 2. Archive the raw chunk response, then parse it for phase 2.
    const raw = JSON.stringify(fetched.json, null, 2)
    await saveRunFile(runId, `source-chunk-${String(window.index).padStart(2, "0")}.json`, raw)
    let parsed: ParsedTripFile
    try {
      parsed = parseSlaStatusResponse(fetched.json)
    } catch (err) {
      return await abort(window, "parse", err, fetched.retriesUsed + 1)
    }
    downloads.set(window.index, {
      index: window.index,
      dateFrom: window.dateFrom,
      dateTill: window.dateTill,
      days: window.days,
      success: true,
      retriesUsed: fetched.retriesUsed,
      httpStatus: fetched.httpStatus,
      responseBytes: Buffer.byteLength(raw),
      rowCount: parsed.rows.length,
      error: null,
    })

    // 3. Phase 2 for this chunk starts now, overlapping the next download.
    const chunkRows = parsed.rows
    calcChain = calcChain.then(async () => {
      const startedAt = Date.now()
      try {
        const { rows, summary } = await processBilling(chunkRows, params)
        rowsByChunk.set(window.index, rows)
        summariesByChunk.set(window.index, summary)
        calculations.set(window.index, {
          index: window.index,
          calculated: true,
          durationMs: Date.now() - startedAt,
          error: null,
        })
      } catch (err) {
        calculations.set(window.index, {
          index: window.index,
          calculated: false,
          durationMs: null,
          error: errMessage(err),
        })
        calcFailures.push({ index: window.index, error: err })
      }
    })
  }

  await calcChain
  if (calcFailures.length > 0) {
    const { index, error } = calcFailures[0]
    await abort(windows[index - 1], "calculation", error, 1)
  }

  await writeManifest(null)

  const byIndex = ([a]: [number, unknown], [b]: [number, unknown]) => a - b
  const rows = [...rowsByChunk.entries()]
    .sort(byIndex)
    .flatMap(([, chunkRows]) => chunkRows)
  const summary = mergeSummaries(
    [...summariesByChunk.entries()].sort(byIndex).map(([, s]) => s)
  )
  return { rows, summary, chunks: records(), totalChunks: windows.length }
}
