// POST /api/billing/calculate — NEW billing API: this app's own server-side
// bill calculation (NOT a proxy of an existing backend endpoint — existing
// backend APIs are called client-side, see lib/api/client.ts).
//
// Flow: receive the form payload + Authorization header → download the
// trip-status .xls from the backend → parse the rows → classify In/Out/Remote
// (with GraphHopper road-distance revalidation) → apply rates, TAT and
// penalties → generate the billing .xlsx and return it as a download.

import { apiErrorResponse, serverAPI } from "@/lib/api/server"
import { processBilling } from "@/lib/billing/calculate"
import { parseTripStatusFile, TRIP_STATUS_COLUMNS } from "@/lib/billing/parse"
import {
  billingReportFileName,
  buildBillingWorkbook,
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

const isPercent = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100

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
    p.action_date_type !== undefined &&
    p.action_date_type !== "START_DATE" &&
    p.action_date_type !== "END_DATE"
  )
    return "action_date_type must be START_DATE or END_DATE"
  if (
    !p.rates ||
    !isNum(p.rates.inStation) ||
    !isNum(p.rates.outStation) ||
    !isNum(p.rates.remote)
  )
    return "rates.inStation, rates.outStation and rates.remote must be numbers"
  if (
    !p.penalties ||
    !isPercent(p.penalties.day1) ||
    !isPercent(p.penalties.day2) ||
    !isPercent(p.penalties.day3) ||
    !isPercent(p.penalties.day4) ||
    !isPercent(p.penalties.day5) ||
    !isPercent(p.penalties.day6) ||
    !isPercent(p.penalties.day7)
  )
    return "penalties.day1–day7 must be percentages between 0 and 100"
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

    // 1. Download the .xls from the backend (Authorization header wins over
    //    the session token; both are the same backend API token).
    const file = await serverAPI.billing.downloadTripStatus(
      {
        dateFrom: payload.dateFrom,
        dateTill: payload.dateTill,
        page: payload.page ?? 1,
        org_id: payload.org_id,
        status: payload.status,
        action_date_type: payload.action_date_type,
      },
      bearerToken(request)
    )

    // 2. Keep the original download, then the submitted form values.
    const ext = file.fileName?.match(/\.(xlsx?|csv)$/i)?.[0] ?? ".xls"
    const sourceFile = await saveRunFile(runId, `source${ext}`, file.buffer)
    await saveRunFile(runId, "request.json", JSON.stringify(payload, null, 2))

    // 3. Parse + classify + bill.
    let parsed
    try {
      parsed = parseTripStatusFile(file.buffer)
    } catch (err) {
      return Response.json(
        {
          success: false,
          message:
            err instanceof Error ? err.message : "Could not read the file",
          runId,
          sourceFile,
        },
        { status: 422 }
      )
    }

    // Column order snapshot (before the billing keys are appended).
    const baseHeaders = parsed.rows.length
      ? Object.keys(parsed.rows[0])
      : [...TRIP_STATUS_COLUMNS]

    const { rows, summary } = await processBilling(parsed.rows, {
      rates: payload.rates,
      penalties: payload.penalties,
      holidays: payload.holidays ?? [],
      // Branch data only applies to orgs with a bundled dataset (Brac Bank
      // PLC); anything else gets [] and keeps the backend classification.
      branches: branchesForOrgs(payload.org_id) ?? [],
    })

    // 4. Generate the Excel report, archive it + the summary, return it.
    const output = buildBillingWorkbook(
      rows,
      baseHeaders,
      parsed.dateFormats,
      summary
    )
    await saveRunFile(runId, "billing_report.xlsx", output)
    await saveRunFile(
      runId,
      "summary.json",
      JSON.stringify({ request: payload, summary }, null, 2)
    )

    const fileName = billingReportFileName(payload.dateFrom, payload.dateTill)
    return new Response(new Uint8Array(output), {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(output.byteLength),
        "X-Total-Rows": String(summary.totalRows),
        "X-Billed-Trips": String(summary.billed),
        "X-Total-Amount": String(summary.totalAmount),
      },
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
