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
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
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

/** Body accepted by the backend trip-status export. */
export interface TripStatusRequest {
  dateFrom: string
  dateTill: string
  page: number
  org_id: string[]
  status: number[]
  action_date_type: "START_DATE" | "END_DATE"
}

/** Result of an upstream endpoint that answers with a file download. */
export interface BackendFile {
  buffer: Buffer
  contentType: string
  /** File name from Content-Disposition, if the backend sent one. */
  fileName?: string
}

/** POST to a backend endpoint that streams back a file (e.g. an .xls export). */
async function backendFetchFile(
  url: string,
  body: unknown
): Promise<BackendFile> {
  const token = await getSessionToken()
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

  const contentType = response.headers.get("content-type") ?? ""

  // Errors (and 200-with-JSON-message replies) are not a file.
  if (!response.ok || contentType.includes("application/json")) {
    let message = defaultApiErrorMessage(response.status)
    try {
      const raw = contentType.includes("application/json")
        ? await response.json()
        : await response.text()
      message = extractUserReadableApiErrorMessage(raw) ?? message
    } catch {
      // keep default
    }
    throw new ApiErrorClass({
      status: response.ok ? 502 : response.status,
      message,
      code:
        response.status >= 500 || response.ok ? "SERVER_ERROR" : "CLIENT_ERROR",
    })
  }

  const disposition = response.headers.get("content-disposition") ?? ""
  const fileName = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(
    disposition
  )?.[1]

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType,
    fileName: fileName ? decodeURIComponent(fileName) : undefined,
  }
}

export const billing = {
  /** Trip history input data (backend endpoint, fetched server-side). */
  getTripHistory: async (params?: {
    dateFrom?: string
    dateTill?: string
    org_id?: string
  }) => {
    return backendFetch<any>(Endpoints.BILL.GET_TRIP_HISTORY, { params })
  },

  /** Trip-status export: the backend answers with an .xls file. */
  downloadTripStatus: async (body: TripStatusRequest) => {
    return backendFetchFile(Endpoints.BILL.GET_TRIP_STATUS, body)
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