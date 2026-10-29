// Central API endpoint registry.
//
// The billing dashboard talks to the SAME backend as verify-admin-dashboard-v3,
// but never calls it from the browser: client components hit this app's own
// /api route handlers (see app/api/), and those forward to the endpoints below
// server-side with the session's Bearer token. That is where the per-org
// billing calculations and CSV generation will run.

// Staging Base URL
export const BASE_URL = process.env?.NEXT_PUBLIC_API_BASE_URL

const AUTH = {
  LOGIN: BASE_URL + "/api/v2/auth/login",
  GET_USER: BASE_URL + "/api/v2/auth/user",
  LOGOUT: BASE_URL + "/logout",
}

const COMMON = {
  GET_GROUP: BASE_URL + "/api/v2/groups", // organization list
}

const DASHBOARD = {
  GET_SUMMARY: BASE_URL + "/api/v2/dashboard/org/summery",
}

const BILL = {
  CALCULATE_BILL: BASE_URL + "/api/v2/calculate-billing",
  GET_TRIP_HISTORY: BASE_URL + "/api/v2/reports/trip-history",
  GET_TRIP_STATUS: BASE_URL + "/api/v2/reports/trip-status", // responds with an .xls download
}

export { AUTH, COMMON, DASHBOARD, BILL }