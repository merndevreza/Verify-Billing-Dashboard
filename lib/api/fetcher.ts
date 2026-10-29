// ============================================================================
// Types
// ============================================================================

export interface ApiRequestOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>
  params?: Record<
    string,
    string | number | boolean | (string | number)[] | undefined
  >
  cache?: RequestCache
  token?: string
}

export interface ApiError {
  status?: number
  message: string
  code?: string
}

export interface ApiResponse<T = unknown> {
  data: T
  status: number
  headers: Headers
}

// ============================================================================
// Core Fetch Function (client-side)
// ============================================================================

/**
 * Core API fetch function for CLIENT components. Calls this app's own
 * /api route handlers (same origin — the NextAuth session cookie is sent
 * automatically); the route handlers then talk to the backend server-side
 * with the session's Bearer token (see lib/api/server.ts).
 */
export async function apiFetch(
  url: string,
  options: ApiRequestOptions = {}
): Promise<Response> {
  const {
    token,
    params,
    headers: customHeaders,
    cache: cacheOption = "no-store",
    ...fetchOptions
  } = options

  // Build URL with query parameters
  let finalUrl = url
  if (params && Object.keys(params).length > 0) {
    const parts: string[] = []
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null) {
            parts.push(
              `${encodeURIComponent(key)}[]=${encodeURIComponent(String(item))}`
            )
          }
        }
      } else {
        parts.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
        )
      }
    }
    if (parts.length > 0) {
      finalUrl += `?${parts.join("&")}`
    }
  }

  // Build headers
  const headers: HeadersInit = {
    ...(customHeaders || {}),
    // Always include Accept header (Laravel API expects this for JSON responses)
    Accept: "application/json",
  }

  // Add Authorization header if token exists (v3 parity: owner debugs the
  // requests in the browser Network tab)
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  // Add Content-Type for JSON requests (unless FormData)
  const isFormData = fetchOptions.body instanceof FormData
  if (
    !isFormData &&
    fetchOptions.method !== "GET" &&
    fetchOptions.method !== "HEAD"
  ) {
    headers["Content-Type"] = "application/json"
  }

  const response = await fetch(finalUrl, {
    ...fetchOptions,
    headers,
    cache: cacheOption,
  })

  // Handle error status codes
  await handleErrorResponse(response)

  return response
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Project error-message policy: the backend's error message must be shown to
 * the user verbatim. Fall back to a front-end default only when the payload is
 * NOT human-readable — a non-string value, an HTML/Laravel debug page, a stack
 * trace, an SQL dump, a namespaced exception class, or server file paths.
 */

/** Anything longer than this is debug output (error page / stack trace), not a message. */
const MAX_READABLE_ERROR_LENGTH = 500

/** Debug/technical markers that make an error message unusable for end users. */
const UNREADABLE_MESSAGE_PATTERNS: RegExp[] = [
  /<(!doctype|html|head|body|title)[\s>]/i, // HTML error pages (Laravel debug/Whoops page)
  /\b(?:whoops|stack trace|traceback)\b/i,
  /\b(?:Symfony|Illuminate|Laravel|App)\\[A-Za-z]/, // namespaced exception classes
  /\b(?:QueryException|PDOException|ErrorException|HttpException|NotFoundExceptionInterface)\b/,
  /SQLSTATE\[[^\]]*\]/i,
  /`[^`]+`/, // backticked SQL identifiers: `applications`.`vendor_id`
  /(?:^|\n)\s*#\d+\s/, // stack-trace frames: "#0 /var/www/html/..."
  /(?:^|\n)\s*at\s+\S+\.php\b/i,
  /\.(?:php|phtml)\b\s*:\s*\d+/, // file references with line numbers: Handler.php:42
  /(?:^|[\s("'])\/(?:var|home|www|usr|srv)\//, // server file paths
  /\b[A-Z]:\\/, // Windows server paths
  /^\s*\[\s*[{"]/, // raw JSON/array dumps
]

function isUserReadableErrorMessage(value: unknown): value is string {
  if (typeof value !== "string") return false
  const message = value.trim()
  if (!message || message.length > MAX_READABLE_ERROR_LENGTH) return false
  // 3+ non-empty lines is a stack trace / debug dump, not a message
  if (message.split("\n").filter((line) => line.trim()).length > 2) return false
  return !UNREADABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
}

/** First human-readable message from a Laravel validation errors bag (422). */
function firstValidationErrorMessage(errors: unknown): string | undefined {
  if (!errors || typeof errors !== "object") return undefined
  for (const value of Object.values(errors as Record<string, unknown>)) {
    for (const candidate of Array.isArray(value) ? value : [value]) {
      if (isUserReadableErrorMessage(candidate)) return candidate.trim()
    }
  }
  return undefined
}

/**
 * Pull the backend's own readable message out of an error payload: a raw
 * string, or a JSON body's `message`/`error`/`detail` field (or the first
 * message of a Laravel 422 `errors` bag). Returns undefined when nothing
 * readable is found — the caller then uses the front-end default.
 */
export function extractUserReadableApiErrorMessage(
  payload: unknown
): string | undefined {
  if (typeof payload === "string") {
    return isUserReadableErrorMessage(payload) ? payload.trim() : undefined
  }
  if (!payload || typeof payload !== "object") return undefined
  const body = payload as Record<string, unknown>
  for (const candidate of [body.message, body.error, body.detail]) {
    if (isUserReadableErrorMessage(candidate)) return candidate.trim()
  }
  return firstValidationErrorMessage(body.errors)
}

/** Front-end defaults, used only when the backend payload isn't a readable message. */
export function defaultApiErrorMessage(status: number): string {
  if (status === 401) return "Unauthorized - Please log in again"
  if (status === 403)
    return "Forbidden - You don't have permission to access this resource"
  if (status === 404) return "Resource not found"
  if (status >= 500) return "Server error - Please try again later"
  return "Request failed"
}

// Single-flight sign-out. Parallel requests can all receive 401 at once, and
// each one calling signOut() independently would race its redirects and abort
// in-flight fetches (same failure mode verify-admin-dashboard-v3 fixed).
let isSigningOut = false

function signOutAndRedirect(): void {
  if (isSigningOut) return
  isSigningOut = true
  // NextAuth signOut clears the session cookie; dynamic import keeps this
  // module importable from server code paths, and .catch guards the chain so
  // signOut failures can never become unhandled rejections.
  import("next-auth/react")
    .then(({ signOut }) =>
      signOut({ callbackUrl: `${window.location.origin}/login` })
    )
    .catch(() => {
      window.location.href = "/login"
    })
}

/**
 * Throw ApiErrorClass for non-2xx responses. 401 triggers a single sign-out
 * + redirect to /login (the session cookie no longer authenticates this
 * app's route handlers).
 */
async function handleErrorResponse(response: Response): Promise<void> {
  const status = response.status

  if (status === 401) {
    if (
      typeof window !== "undefined" &&
      window.location.pathname !== "/login"
    ) {
      signOutAndRedirect()
    }
    throw new ApiErrorClass({
      status: 401,
      message: "Unauthorized - Please log in again",
      code: "UNAUTHORIZED",
    })
  }

  if (status >= 400) {
    let message = defaultApiErrorMessage(status)
    try {
      const contentType = response.headers.get("content-type")
      if (contentType?.includes("application/json")) {
        message =
          extractUserReadableApiErrorMessage(await response.clone().json()) ??
          message
      } else {
        message =
          extractUserReadableApiErrorMessage(await response.clone().text()) ??
          message
      }
    } catch {
      // Unparseable body — keep the front-end default
    }
    throw new ApiErrorClass({
      status,
      message,
      code:
        status >= 500
          ? "SERVER_ERROR"
          : status === 403
            ? "FORBIDDEN"
            : status === 404
              ? "NOT_FOUND"
              : "CLIENT_ERROR",
    })
  }
}

// ============================================================================
// Typed HTTP Helpers
// ============================================================================

/**
 * GET request with optional query parameters
 */
export async function apiGet<T>(
  url: string,
  params?: Record<string, string | number | boolean | undefined>,
  options?: Omit<ApiRequestOptions, "params" | "method">
): Promise<T> {
  const response = await apiFetch(url, {
    ...options,
    params,
    method: "GET",
  })
  return parseJsonResponse<T>(response)
}

/**
 * POST request with JSON body
 */
export async function apiPost<T>(
  url: string,
  data?: unknown,
  options?: Omit<ApiRequestOptions, "method">
): Promise<T> {
  const response = await apiFetch(url, {
    ...options,
    method: "POST",
    body: data ? JSON.stringify(data) : undefined,
  })
  return parseJsonResponse<T>(response)
}

/**
 * PUT request with JSON body
 */
export async function apiPut<T>(
  url: string,
  data?: unknown,
  options?: Omit<ApiRequestOptions, "method">
): Promise<T> {
  const response = await apiFetch(url, {
    ...options,
    method: "PUT",
    body: data ? JSON.stringify(data) : undefined,
  })
  return parseJsonResponse<T>(response)
}

/**
 * DELETE request with optional body
 */
export async function apiDelete<T>(
  url: string,
  options?: Omit<ApiRequestOptions, "method"> & { data?: unknown }
): Promise<T> {
  const { data, ...restOptions } = options || {}
  const response = await apiFetch(url, {
    ...restOptions,
    method: "DELETE",
    body: data ? JSON.stringify(data) : undefined,
  })
  return parseJsonResponse<T>(response)
}

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Safely parse JSON response
 */
export async function parseJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type")

  // Handle empty responses (e.g., 204 No Content)
  if (response.status === 204 || !contentType) {
    return undefined as T
  }

  // Parse JSON response
  if (contentType?.includes("application/json")) {
    return response.json()
  }

  // For non-JSON responses, return text
  const text = await response.text()
  return text as T
}

// ============================================================================
// Error Class
// ============================================================================

export class ApiErrorClass extends Error {
  status?: number
  code?: string

  constructor({ status, message, code }: ApiError) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

// Export for convenience
export const ApiError = ApiErrorClass
