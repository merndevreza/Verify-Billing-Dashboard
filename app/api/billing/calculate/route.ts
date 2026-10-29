// POST /api/billing/calculate — NEW billing API: this app's own server-side
// bill calculation (NOT a proxy of an existing backend endpoint — existing
// backend APIs are called client-side, see lib/api/client.ts).
//
// Flow: receive the form payload → download the trip-status .xls from the
// backend (session Bearer token) → save it locally → parse the rows →
// apply rates by in_out_remote → save the processed JSON locally.

import { applyRates } from "@/lib/billing/calculate"
import { parseTripStatusFile } from "@/lib/billing/parse"
import { newRunId, saveRunFile } from "@/lib/billing/storage"
import { apiErrorResponse, serverAPI } from "@/lib/api/server"
import type { CalculateBillPayload } from "@/lib/types/billing"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

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
  if (!Array.isArray(p.status) || p.status.length === 0)
    return "status must be a non-empty array"
  if (p.action_date_type !== "START_DATE" && p.action_date_type !== "END_DATE")
    return "action_date_type must be START_DATE or END_DATE"
  if (
    !p.rates ||
    !isNum(p.rates.inStation) ||
    !isNum(p.rates.outStation) ||
    !isNum(p.rates.remote)
  )
    return "rates.inStation, rates.outStation and rates.remote must be numbers"
  return null
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

    // 1. Download the .xls from the backend (only the fields it understands).
    const file = await serverAPI.billing.downloadTripStatus({
      dateFrom: payload.dateFrom,
      dateTill: payload.dateTill,
      page: payload.page ?? 1,
      org_id: payload.org_id,
      status: payload.status,
      action_date_type: payload.action_date_type,
    })

    // 2. Keep the original download, then the submitted form values.
    const ext = file.fileName?.match(/\.(xlsx?|csv)$/i)?.[0] ?? ".xls"
    const sourceFile = await saveRunFile(runId, `source${ext}`, file.buffer)
    await saveRunFile(runId, "request.json", JSON.stringify(payload, null, 2))

    // 3. Parse + calculate.
    let rows
    try {
      rows = parseTripStatusFile(file.buffer)
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
    const { rows: billed, summary } = applyRates(rows, payload.rates)

    // 4. Save the processed result.
    const resultFile = await saveRunFile(
      runId,
      "result.json",
      JSON.stringify({ request: payload, summary, rows: billed }, null, 2)
    )

    return Response.json({
      success: true,
      runId,
      sourceFile,
      resultFile,
      summary,
      preview: billed.slice(0, 5),
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}