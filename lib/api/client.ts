/**
 * Client-side API service for use in Client Components — calls the backend
 * DIRECTLY (same as verify-admin-dashboard-v3) so every request is visible
 * in the browser Network tab. The Bearer token comes from the NextAuth
 * session (`useAuth().token`).
 *
 * Only the NEW billing APIs (calculation/report generation) go through this
 * app's own route handlers instead — see lib/api/server.ts and app/api/billing/.
 *
 * Usage in Client Components:
 * ```ts
 * import { clientAPI } from '@/lib/api'
 * import { useAuth } from '@/lib/auth/clientAuth'
 *
 * function MyComponent() {
 *   const { token } = useAuth()
 *   const orgs = await clientAPI.organizations.getOrganizations(token)
 * }
 * ```
 */

import * as Endpoints from "@/app.config"
import { apiGet } from "./fetcher"

// ============================================================================
// AUTH
// ============================================================================

export const auth = {
  /** Get current user details (profile + permissions). */
  getUser: async (token: string) => {
    return apiGet<any>(Endpoints.AUTH.GET_USER, undefined, { token })
  },
}

// ============================================================================
// ORGANIZATIONS
// ============================================================================

export const organizations = {
  /** Organization/group list — drives per-org bill generation. */
  getOrganizations: async (token?: string) => {
    return apiGet<any[]>(Endpoints.COMMON.GET_GROUP, undefined, { token })
  },
}

// ============================================================================
// BILLING (existing backend endpoints — input data for the reports)
// ============================================================================

export type TripHistoryParams = {
  dateFrom?: string
  dateTill?: string
  org_id?: string
}

export const billing = {
  /** Trip history input data for billing reports. */
  getTripHistory: async (params?: TripHistoryParams, token?: string) => {
    return apiGet<any>(Endpoints.BILL.GET_TRIP_HISTORY, params, { token })
  },
}

// ============================================================================
// Export all as a single object
// ============================================================================

export const clientAPI = {
  auth,
  organizations,
  billing,
}
