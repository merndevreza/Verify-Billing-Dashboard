// POST /api/billing/calculate — NEW billing API: this app's own server-side
// bill calculation (NOT a proxy of an existing backend endpoint — existing
// backend APIs are called client-side, see lib/api/client.ts).
//
// Flow: receive the form payload + Authorization header → download the
// sla-status report (JSON) from the backend in ≤5-day chunks, one chunk at a
// time (the backend fails on full-month ranges; lib/billing/chunked-run.ts)
// → parse the rows → validate IN against the Dhaka city corporation boundary
// (data/dhaka.geojson) and classify IN/OUT/REMOTE by point-in-isochrone
// containment against the org's branch isochrones (lib/billing/isochrones.ts)
// → apply rates, TAT and penalties → generate the billing .xlsx (with a
// "Chunk Details" audit sheet) and return it as a download. Any permanently
// failed chunk aborts the run with an error naming the chunk — no partial bill.

import { auth } from "@/auth"
import { apiErrorResponse } from "@/lib/api/server"
import { loadIsochrones } from "@/lib/billing/isochrones"
import { isochronesForOrgs } from "@/lib/billing/org-isochrones"
import {
  MAX_CHUNK_DAYS,
  ChunkFailureError,
  runChunkedBilling,
} from "@/lib/billing/chunked-run"
import { TRIP_STATUS_COLUMNS } from "@/lib/billing/parse"
import {
  billingReportFileName,
  buildBillingWorkbook,
  chunkSheetRows,
} from "@/lib/billing/report"
import { branchesForOrgs } from "@/lib/billing/org-branches"
import { newRunId, saveRunFile } from "@/lib/billing/storage"
import type { CalculateBillPayload } from "@/lib/types/billing"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

function badRequest(message: string) {
  return Response.json({ success: false, message }, { status: 400 })
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0

/** Returns an error message, or null when the payload is valid. */
function validate(p: Partial<CalculateBillPayload> | null): string | null {
  if (!p || typeof p !== "object") return "Request body must be JSON"
  if (!ISO_DATE.test(p.dateFrom ?? "") || !ISO_DATE.test(p.dateTill ?? ""))
    return "dateFrom and dateTill must be yyyy-mm-dd"
  if (p.dateFrom! > p.dateTill!) return "dateFrom must not be after dateTill"
  if (!Array.isArray(p.org_id) || p.org_id.length === 0)
    return "org_id must be a non-empty array"
  if (
    p.status !== undefined &&
    (!Array.isArray(p.status) || p.status.some((s) => typeof s !== "number"))
  )
    return "status must be an array of numbers"
  if (
    !p.rates ||
    !isNum(p.rates.inStation) ||
    !isNum(p.rates.outStation) ||
    !isNum(p.rates.remote)
  )
    return "rates.inStation, rates.outStation and rates.remote must be numbers"
  if (
    p.holidays !== undefined &&
    (!Array.isArray(p.holidays) ||
      p.holidays.some((h) => typeof h !== "string" || !ISO_DATE.test(h)))
  )
    return "holidays must be yyyy-mm-dd dates"
  return null
}

/** Bearer token from the request Authorization header, if one was sent. */
function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization")
  return header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim() || undefined
    : undefined
}

export async function POST(request: Request) {
  let payload: CalculateBillPayload
  try {
    payload = await request.json()
  } catch {
    return badRequest("Request body must be JSON")
  }
  const invalid = validate(payload)
  if (invalid) return badRequest(invalid)

  try {
    const runId = newRunId()

    // Keep the submitted form values first so even an aborted chunked run
    // leaves the request behind for audits.
    await saveRunFile(runId, "request.json", JSON.stringify(payload, null, 2))

    // Session user, recorded on the report's "Request Details" sheet.
    const session = await auth()

    // Resolve branch isochrones: throws when branch data is missing or
    // generation fails, returns null when the org is not in the registry.
    const orgBranches = branchesForOrgs(payload.org_id)
    let orgIsochrones
    try {
      orgIsochrones = await isochronesForOrgs(payload.org_id)
    } catch (err) {
      return Response.json(
        { success: false, message: err instanceof Error ? err.message : String(err) },
        { status: 422 }
      )
    }

    // 1. Download the sla-status report in ≤MAX_CHUNK_DAYS-day chunks
    //    (Authorization header wins over the session token; both are the same
    //    backend API token) and bill each chunk as soon as its download lands.
    let result
    try {
      result = await runChunkedBilling({
        payload,
        token: bearerToken(request),
        runId,
        onParams: () => ({
          rates: payload.rates,
          holidays: payload.holidays ?? [],
          isochrones: orgIsochrones
            ? loadIsochrones(orgIsochrones.file).isochrones
            : [],
        }),
      })
    } catch (error) {
      if (!(error instanceof ChunkFailureError)) throw error
      // A chunk failed permanently: no partial bill — answer with an error
      // that names the chunk so the user knows exactly what is missing.
      return Response.json(
        {
          success: false,
          message: error.message,
          runId,
          chunk: error.chunk,
          phase: error.phase,
          manifestFile: error.manifestFile,
        },
        { status: error.phase === "calculation" ? 500 : 502 }
      )
    }

    const { rows, summary } = result

    // An empty data set means the filters matched nothing — that is an
    // input mistake, not a bill. Fail loudly instead of generating a 0-row
    // report.
    if (summary.totalRows === 0) {
      return Response.json(
        {
          success: false,
          message: `The sla-status report contains no rows across ${result.totalChunks} chunk(s) — check the date range, organization and status filters`,
          runId,
        },
        { status: 422 }
      )
    }

    // Column order snapshot (before the billing keys are appended). Parse
    // emits rows in exactly this order; unlike Object.keys(rows[0]) this is
    // safe when the early chunks of the run came back empty.
    const baseHeaders = [...TRIP_STATUS_COLUMNS]

    // 2. Generate the Excel report, archive it + the summary, return it.
    const output = await buildBillingWorkbook(
      rows,
      baseHeaders,
      {}, // the sla-status JSON carries no cell formats; report default applies
      summary,
      {
        dateFrom: payload.dateFrom,
        dateTill: payload.dateTill,
        orgName: orgBranches?.orgName ?? null,
        chunks: {
          maxChunkDays: MAX_CHUNK_DAYS,
          chunkRows: chunkSheetRows(result.chunks),
        },
        request: {
          orgIds: payload.org_id,
          status: payload.status,
          billingType: payload.billingType,
          holidays: payload.holidays,
          rates: payload.rates,
          generatedBy: {
            name: session?.user?.name ?? null,
            email: session?.user?.email ?? null,
          },
        },
      }
    )
    await saveRunFile(runId, "billing_report.xlsx", output)
    await saveRunFile(
      runId,
      "summary.json",
      JSON.stringify(
        {
          request: payload,
          chunked: true,
          totalChunks: result.totalChunks,
          chunks: result.chunks,
          // Which org's branch rules were applied (null = backend verdicts kept).
          branchDatasetOrg: orgBranches?.orgName ?? null,
          // IN validation source: coordinates inside this boundary are IN.
          dhakaBoundary: "data/dhaka.geojson",
          // Zone classification source: point-in-isochrone containment.
          isochroneDataset: orgIsochrones?.file ?? null,
          summary,
        },
        null,
        2
      )
    )

    const fileName = billingReportFileName(payload.dateFrom, payload.dateTill)
    return new Response(new Uint8Array(output), {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(output.byteLength),
        // Handle to the archived run (.data/billing/<runId>/) for audits.
        "X-Run-Id": runId,
        "X-Total-Rows": String(summary.totalRows),
        "X-Billed-Trips": String(summary.billed),
        "X-Total-Amount": String(summary.totalAmount),
      },
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
