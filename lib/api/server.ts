// ============================================================================
// Server-side helpers — used ONLY by the NEW billing API route handlers
// (app/api/billing/**) that host this app's own calculation/report logic.
//
// Existing backend APIs are NOT proxied through this app: client components
// call them directly via lib/api/client.ts (Bearer from the session) so they
// stay visible in the browser Network tab. Route handlers fetch backend data
// server-side only as INPUT for the billing calculations, via the helpers
// below.
// ============================================================================

import { auth as getServerSession } from "@/auth"
import * as Endpoints from "@/app.config"
import {
  ApiErrorClass,
  defaultApiErrorMessage,
  extractUserReadableApiErrorMessage,
} from "./fetcher"

/**
 * The backend Bearer token lives in the NextAuth JWT. Route handlers resolve
 * it from the session cookie and attach it on upstream input-data requests.
 */
export async function getSessionToken(): Promise<string | undefined> {
  const session = await getServerSession()
  return session?.accessToken
}

// ============================================================================
// Backend input data for the billing calculations
// ============================================================================

/** Body accepted by the backend sla-status report. */
export interface TripStatusRequest {
  dateFrom: string
  dateTill: string
  page: number
  org_id: string[]
  /** Omitted from the request body when undefined (no status filter). */
  status?: number[]
}

/** Result of the backend sla-status report endpoint. */
export interface SlaStatusResponse {
  /** The report rows; validated/normalized downstream (lib/billing/parse.ts). */
  data?: unknown
  /** Envelope fields; a non-200 body status is treated as an upstream error. */
  status?: number
  message?: string
}

/** POST to a backend endpoint that answers with a JSON payload. */
async function backendFetchJson(
  url: string,
  body: unknown,
  tokenOverride?: string
): Promise<unknown> {
  const token = tokenOverride ?? (await getSessionToken())
  if (!token) {
    throw new ApiErrorClass({
      status: 401,
      message: "No active session — please log in again",
      code: "UNAUTHORIZED",
    })
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(5 * 60_000), // exports can be slow
  })

  if (!response.ok) {
    let message = defaultApiErrorMessage(response.status)
    try {
      message =
        extractUserReadableApiErrorMessage(await response.json()) ?? message
    } catch {
      // keep default
    }
    throw new ApiErrorClass({
      status: response.status,
      message,
      code: response.status >= 500 ? "SERVER_ERROR" : "CLIENT_ERROR",
    })
  }

  try {
    return await response.json()
  } catch {
    throw new ApiErrorClass({
      status: 502,
      message: "The backend returned a non-JSON response",
      code: "SERVER_ERROR",
    })
  }
}

export const billing = {
  /** SLA-status report: the backend answers with JSON { data, message, status }. */
  fetchSlaStatus: async (body: TripStatusRequest, token?: string) => {
    const json = (await backendFetchJson(
      Endpoints.BILL.GET_SLA_STATUS,
      body,
      token
    )) as SlaStatusResponse

    // This backend reports failures inside a 200 response via its
    // { status, message } envelope — surface them as upstream errors instead
    // of letting them reach the row parser.
    if (json.status !== undefined && json.status !== 200) {
      const message =
        typeof json.message === "string" && json.message.trim().length > 0
          ? json.message
          : defaultApiErrorMessage(502)
      throw new ApiErrorClass({
        status: 502,
        message,
        code: "SERVER_ERROR",
      })
    }

    return json
  },
}

export const serverAPI = {
  billing,
}

// ============================================================================
// Error → HTTP response mapping for route handlers
// ============================================================================

/** Map a thrown error from the upstream fetchers into a JSON error response. */
export function apiErrorResponse(error: unknown): Response {
  if (error instanceof ApiErrorClass) {
    return Response.json(
      { success: false, message: error.message },
      { status: error.status ?? 500 }
    )
  }
  console.error("[api] Unhandled route error:", error)
  return Response.json(
    { success: false, message: "Internal server error" },
    { status: 500 }
  )
}