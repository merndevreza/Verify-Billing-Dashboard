// Core billing engine: classification (Dhaka boundary + Rule 2 + 11), TAT
// (Rule 4, 5, 11.A), penalty (Rule 6) and final price (Rule 7). Runs on the
// parsed trip rows in place — no row copies — and routes Out/Remote
// candidates through the selected routing provider (see import below) with
// caching, a straight-line prefilter, nearest-first early exit and bounded
// concurrency.

import {
  branchesForDistrict,
  districtBranchIndex,
  isDhakaDistrict,
  type Branch,
} from "./branches"
import {
  countHolidaysBetween,
  diffCalendarDays,
  parseCalendarDate,
  parseDateTimeSerial,
} from "./dates"
import { isInsideDhakaBoundary } from "./dhaka-boundary"
// Routing provider — pick ONE by commenting the other out.
// 1. graphhopper: self-hosted GraphHopper (graphhopper-bd docker, GRAPHHOPPER_URL)
// 2. barikoi-routing: Barikoi routing API (needs BARIKOI_API_KEY in .env)

import { routeDistanceM } from "./graphhopper"
 export { ROUTER_PROVIDER } from "./graphhopper"
// import { routeDistanceM } from "./barikoi-routing"
// export { ROUTER_PROVIDER } from "./barikoi-routing"

import type { BillSummary, BillingRow, TripStatusRow } from "./types"

export interface BillingParams {
  rates: { inStation: number; outStation: number; remote: number }
  /** ISO calendar dates (yyyy-mm-dd) excluded from the TAT count. */
  holidays: string[]
  /**
   * The selected org's branch dataset (branchesForOrgs). Empty → the org has
   * no bundled branch data: no Dhaka rule, no branch distance checks — the
   * backend's OUT/REMOTE classification stands as-is.
   */
  branches: Branch[]
}

/** Completion SLA per zone, in days (Rule 5). */
const EXPECTED_DAYS = { IN: 1, OUT: 2, REMOTE: 3 } as const
type Zone = keyof typeof EXPECTED_DAYS

/** Rule 11.C — routing failed; billing skipped for the row. */
export const ROUTE_UNAVAILABLE_MARKER = "ROUTE_DISTANCE_UNAVAILABLE"
/** Row needs routing but its coordinates are missing/invalid. */
export const INVALID_COORDINATES_MARKER = "INVALID_COORDINATES"

/** Rule 6 — SLA-breach penalty: 10% per extra TAT day, capped at 100%. */
const PENALTY_PERCENT_PER_DAY = 10
const MAX_PENALTY_PERCENT = 100
const ROUTE_CONCURRENCY = 8
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function toCoord(value: unknown): number {
  return typeof value === "number" ? value : Number(String(value ?? "").trim())
}

/** The "Attention Needed" cell: joined hybrid-estimate notes, or null. */
function attentionFrom(estimateNotes: string[]): string | null {
  if (estimateNotes.length === 0) return null
  return (
    `MANUAL CHECK — distance estimated for ${estimateNotes.length} branch(es) ` +
    `(trip end off the mapped road graph): ${estimateNotes.join("; ")}`
  )
}

export async function processBilling(
  rows: TripStatusRow[],
  params: BillingParams
): Promise<{ rows: BillingRow[]; summary: BillSummary }> {
  const holidays = new Set(params.holidays)
  const districtIndex = districtBranchIndex(params.branches)
  const summary: BillSummary = {
    totalRows: rows.length,
    billed: 0,
    classification: { in: 0, out: 0, remote: 0 },
    routeUnavailable: 0,
    invalidCoordinates: 0,
    tatUnavailable: 0,
    unclassified: 0,
    totalAmount: 0,
  }

  type ClassifyOutcome =
    | Zone
    | null
    | typeof ROUTE_UNAVAILABLE_MARKER
    | typeof INVALID_COORDINATES_MARKER

  interface ClassifyResult {
    outcome: ClassifyOutcome
    /** Human-readable audit trail of the branch comparisons for this row. */
    comparison: string | null
    /**
     * Manual-check flag for rows whose distance came from the hybrid
     * estimate — null when every routed distance was exact.
     */
    attention?: string | null
  }

  /**
   * Dhaka boundary validation + Rule 2 + 11 for one row. Returns the final
   * zone (null when the row cannot be classified, or a marker for the failure
   * cases) plus the audit trail.
   */
  async function classify(row: TripStatusRow): Promise<ClassifyResult> {
    const existing = String(row.in_out_remote ?? "").trim().toUpperCase()
    if (existing !== "IN" && existing !== "OUT" && existing !== "REMOTE") {
      return { outcome: null, comparison: null }
    }

    // Step 0 — IN validation against the Dhaka city corporation boundary
    // (data/dhaka.geojson). Coordinates inside the boundary are IN no matter
    // what the backend claimed; a claimed-IN row that fails the boundary
    // test is rejected and continues through the OUT/REMOTE steps below like
    // any other non-IN row.
    const lat = toCoord(row.Latitude)
    const lon = toCoord(row.Longitude)
    const coordsValid =
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      !(lat === 0 && lon === 0)

    /** Reason an IN claim failed the boundary test, when it did. */
    let auditPrefix: string | null = null
    const withPrefix = (comparison: string | null) =>
      auditPrefix
        ? comparison
          ? `${auditPrefix}; ${comparison}`
          : auditPrefix
        : comparison

    if (coordsValid) {
      if (isInsideDhakaBoundary(lat, lon)) {
        return {
          outcome: "IN",
          comparison:
            "coordinates inside the Dhaka city corporation boundary",
        }
      }
      if (existing === "IN") {
        auditPrefix =
          "IN claim rejected: coordinates outside the Dhaka city corporation boundary"
      }
    } else if (existing === "IN") {
      auditPrefix = "IN claim rejected: coordinates missing or invalid"
    }

    // Orgs without a bundled branch dataset: no reclassification — the
    // backend's OUT/REMOTE stands: the rule set belongs to the branch
    // dataset, so orgs without one get the backend's verdict verbatim. A
    // rejected IN claim has no backend OUT/REMOTE verdict to keep and no
    // rule set to reclassify with, so it is left unbilled (unclassified)
    // with the rejection noted instead of being guessed.
    if (params.branches.length === 0) {
      if (existing === "IN") {
        return {
          outcome: null,
          comparison: withPrefix(
            "organization has no branch dataset to reclassify with"
          ),
        }
      }
      const kept: Zone = existing === "OUT" ? "OUT" : "REMOTE"
      return {
        outcome: kept,
        comparison:
          "organization has no branch dataset; backend classification kept",
      }
    }

    // Confirmed rule: Dhaka-district trips outside the metro boundary are
    // always OUT, no branch check.
    if (isDhakaDistrict(row.District)) {
      return {
        outcome: "OUT",
        comparison: withPrefix("Dhaka district; no branch check"),
      }
    }

    // Eligible branches for this district (category "out" only).
    const districtBranches = branchesForDistrict(row.District, districtIndex) ?? []
    if (districtBranches.length === 0) {
      // Rule 11.B
      return {
        outcome: "REMOTE",
        comparison: withPrefix(
          `no eligible branch for district "${row.District}"`
        ),
      }
    }

    // Coordinates are mandatory from here on: routing needs them. For
    // claimed OUT/REMOTE rows this is the pre-existing check; a rejected IN
    // claim lands here too when its coordinates cannot be validated.
    if (!coordsValid) {
      return { outcome: INVALID_COORDINATES_MARKER, comparison: auditPrefix }
    }

    const comparisons: string[] = []
    /** Per-branch hybrid-estimate notes — non-empty → row needs manual check. */
    const estimateNotes: string[] = []

    // Route all eligible branches. OUT as soon as ANY candidate fits within
    // its own radius; REMOTE only after every candidate was measured and
    // exceeded its radius. Any failed candidate → Rule 11.C marker.
    let measured = 0
    let anyFailed = false
    for (let i = 0; i < districtBranches.length; i++) {
      const branch = districtBranches[i]
      try {
        const result = await routeDistanceM([lat, lon], [branch.lat, branch.lon])
        measured++
        const km = result.meters / 1000
        if (result.estimated) {
          estimateNotes.push(
            `${branch.branch_name} (${km.toFixed(2)} km): ${result.note}`
          )
        }
        if (km <= branch.max_distance_km) {
          const earlyExit =
            i < districtBranches.length - 1
              ? ", remaining branches not routed"
              : ""
          comparisons.push(
            `${branch.branch_name}: ${km.toFixed(2)} km ≤ ${branch.max_distance_km} km limit${earlyExit}`
          )
          return {
            outcome: "OUT",
            comparison: comparisons.join("; "),
            attention: attentionFrom(estimateNotes),
          }
        }
        comparisons.push(
          `${branch.branch_name}: ${km.toFixed(2)} km > ${branch.max_distance_km} km limit`
        )
      } catch {
        anyFailed = true
        comparisons.push(`${branch.branch_name}: route failed`)
      }
    }
    const attention = attentionFrom(estimateNotes)
    return measured === districtBranches.length && !anyFailed
      ? { outcome: "REMOTE", comparison: withPrefix(comparisons.join("; ")), attention }
      : {
          outcome: ROUTE_UNAVAILABLE_MARKER,
          comparison: withPrefix(comparisons.join("; ")),
          attention,
        }
  }

  /** Rules 3–7 for a classified row. Returns false when TAT is not computable. */
  function applyBilling(row: BillingRow, zone: Zone): boolean {
    const rate =
      zone === "IN"
        ? params.rates.inStation
        : zone === "OUT"
          ? params.rates.outStation
          : params.rates.remote
    row["Rate"] = rate

    // Submission Date keeps the backend's date + time (the same Excel serial
    // form as the other date columns); the TAT count uses the calendar date
    // only. Set before the TAT checks so it also shows on tatUnavailable rows.
    const submission = parseDateTimeSerial(row["api_submission_time"])
    row["Submission Date"] = submission
    const receiveISO = parseCalendarDate(row["Receive Date"])
    const submissionISO = submission === null ? null : parseCalendarDate(submission)
    const verifyISO = parseCalendarDate(row.VerificationDateTime)
    if (!receiveISO || !verifyISO || !submissionISO) return false
    // TAT counts the days SPENT: the Receive day itself is not counted (the
    // job can arrive at any time of that day), so the count runs from the day
    // after Receive through the Submission day. Holidays falling between the
    // two dates are subtracted.
    const tatDays =
      diffCalendarDays(receiveISO, submissionISO) -
      countHolidaysBetween(receiveISO, submissionISO, holidays)
    const tatExtra = Math.max(0, tatDays - EXPECTED_DAYS[zone])
    const penalty = Math.min(
      tatExtra * PENALTY_PERCENT_PER_DAY,
      MAX_PENALTY_PERCENT
    )
    row["TAT Days"] = tatDays
    row["TAT Extra"] = tatExtra
    row["Penalty"] = penalty
    row["Price After Penalty"] = round2((rate * (100 - penalty)) / 100)
    return true
  }

  async function processRow(row: TripStatusRow): Promise<void> {
    const billingRow = row as BillingRow
    billingRow["Submission Date"] = null
    billingRow["Rate"] = null
    billingRow["TAT Days"] = null
    billingRow["TAT Extra"] = null
    billingRow["Penalty"] = null
    billingRow["Price After Penalty"] = null
    billingRow["Compared Branches And Distances"] = null
    billingRow["Attention Needed"] = null

    const { outcome: zone, comparison, attention } = await classify(row)
    billingRow["Compared Branches And Distances"] = comparison
    billingRow["Attention Needed"] = attention ?? null

    if (zone === null) {
      summary.unclassified++
      return
    }
    if (zone === ROUTE_UNAVAILABLE_MARKER) {
      row.in_out_remote = ROUTE_UNAVAILABLE_MARKER
      summary.routeUnavailable++
      return
    }
    if (zone === INVALID_COORDINATES_MARKER) {
      row.in_out_remote = INVALID_COORDINATES_MARKER
      summary.invalidCoordinates++
      return
    }

    row.in_out_remote = zone
    if (zone === "IN") summary.classification.in++
    else if (zone === "OUT") summary.classification.out++
    else summary.classification.remote++

    if (applyBilling(billingRow, zone)) {
      summary.billed++
      summary.totalAmount += billingRow["Price After Penalty"] ?? 0
    } else {
      summary.tatUnavailable++
    }
  }

  let cursor = 0
  const workerCount = Math.max(1, Math.min(ROUTE_CONCURRENCY, rows.length))
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++]
        await processRow(row)
      }
    })
  )

  summary.totalAmount = round2(summary.totalAmount)
  return { rows: rows as BillingRow[], summary }
}
