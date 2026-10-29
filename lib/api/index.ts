/**
 * API Layer Barrel Export
 *
 * Two distinct layers — do not mix them:
 *
 * - `clientAPI` (lib/api/client.ts) — CLIENT components. Calls the backend
 *   DIRECTLY with the session Bearer token — visible in the Network tab
 *   (same convention as verify-admin-dashboard-v3).
 * - `serverAPI` (lib/api/server.ts) — the NEW billing route handlers under
 *   app/api/billing/ ONLY. Fetches backend input data server-side for the
 *   calculation/report logic.
 */

// Client-side API (backend called directly, Bearer from useAuth().token)
export * as clientAPI from "./client"

// Server-side API for the new billing route handlers — importing this from a
// client component will break the build; it pulls in `@/auth`.
export * as serverAPI from "./server"

// Core fetcher (for direct usage if needed)
export * from "./fetcher"
