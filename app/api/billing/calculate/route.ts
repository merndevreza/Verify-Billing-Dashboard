// POST /api/billing/calculate — NEW billing API: this app's own server-side
// per-organization bill calculation (NOT a proxy of an existing backend
// endpoint — existing backend APIs are called client-side, see lib/api/client.ts).
//
// TODO(billing): implement the calculation + CSV report generation here.
// Backend input data is fetched server-side via
// `serverAPI.billing.getTripHistory(...)` from "@/lib/api/server" (the
// session Bearer token is attached automatically).

export const dynamic = "force-dynamic"

export async function POST() {
  return Response.json(
    { success: false, message: "Billing calculation is not implemented yet" },
    { status: 501 }
  )
}
