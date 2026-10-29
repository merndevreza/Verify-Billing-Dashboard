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
  parseJsonResponse,
} from "./fetcher"

/**
 * The backend Bearer token lives in the NextAuth JWT. Route handlers resolve
 * it from the session cookie and attach it on upstream input-data requests.
 */
export async function getSessionToken(): Promise<string | undefined> {
  const session = await getServerSession()
  return session?.accessToken
}

interface BackendRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  params?: Record<string, string | number | boolean | undefined>
  body?: unknown
}

/** Single upstream request with session Bearer auth and project error policy. */
async function backendFetch<T>(
  url: string,
  options: BackendRequestOptions = {}
): Promise<T> {
  const { method = "GET", params, body } = options

  const token = await getSessionToken()
  if (!token) {
    throw new ApiErrorClass({
      status: 401,
      message: "No active session — please log in again",
      code: "UNAUTHORIZED",
    })
  }

  let finalUrl = url
  if (params && Object.keys(params).length > 0) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        search.set(key, String(value))
      }
    }
    const query = search.toString()
    if (query) finalUrl += `?${query}`
  }

  const response = await fetch(finalUrl, {
    method,
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    // Same error-message policy as the client fetcher: surface the backend's
    // own readable message, fall back to a front-end default otherwise.
    let message = defaultApiErrorMessage(response.status)
    try {
      const contentType = response.headers.get("content-type")
      if (contentType?.includes("application/json")) {
        message =
          extractUserReadableApiErrorMessage(await response.json()) ?? message
      } else {
        message =
          extractUserReadableApiErrorMessage(await response.text()) ?? message
      }
    } catch {
      // Unparseable body — keep the front-end default
    }
    throw new ApiErrorClass({
      status: response.status,
      message,
      code:
        response.status >= 500
          ? "SERVER_ERROR"
          : response.status === 403
            ? "FORBIDDEN"
            : response.status === 404
              ? "NOT_FOUND"
              : "CLIENT_ERROR",
    })
  }

  return parseJsonResponse<T>(response)
}

// ============================================================================
// Backend input data for the billing calculations
// ============================================================================

export const billing = {
  /** Trip history input data (backend endpoint, fetched server-side). */
  getTripHistory: async (params?: {
    dateFrom?: string
    dateTill?: string
    org_id?: string
  }) => {
    return backendFetch<any>(Endpoints.BILL.GET_TRIP_HISTORY, { params })
  },
}

export const serverAPI = {
  billing,
}

// ============================================================================
// Error → HTTP response mapping for route handlers
// ============================================================================

/** Map a thrown error from backendFetch into a JSON error response. */
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
