// Core billing engine: classification (Dhaka city corporation boundary → IN;
// Dhaka district boundary → OUT; branch isochrone containment → OUT, none →
// REMOTE; branch category ignored), TAT (Rule 4, 5), penalty (Rule 6) and
// final price
// (Rule 7). Runs on the parsed trip rows in place — no row copies — and is
// fully synchronous: every classification is a local point-in-polygon test
// against the org's branch isochrones (see isochrones.ts), no routing calls.

import {
  countHolidaysBetween,
  diffCalendarDays,
  parseCalendarDate,
  parseDateTimeSerial,
} from "./dates"
import { isInsideDhakaBoundary, isInsideDhakaDistrict } from "./dhaka-boundary"
import { findIsochroneMatches, type BranchIsochrone } from "./isochrones"

import type { BillSummary, BillingRow, TripStatusRow } from "./types"

export interface BillingParams {
  rates: { inStation: number; outStation: number; remote: number }
  /** ISO calendar dates (yyyy-mm-dd) excluded from the TAT count. */
  holidays: string[]
  /**
   * The selected org's branch isochrone polygons (loadIsochrones). Empty →
   * the org has no isochrone dataset: no reclassification — the backend's
   * OUT/REMOTE classification stands as-is.
   */
  isochrones: BranchIsochrone[]
}

/** Completion SLA per zone, in days (Rule 5). */
const EXPECTED_DAYS = { IN: 1, OUT: 2, REMOTE: 3 } as const
type Zone = keyof typeof EXPECTED_DAYS

/** The row's coordinates are missing/invalid; zone classification is impossible. */
export const INVALID_COORDINATES_MARKER = "INVALID_COORDINATES"

/** Rule 6 — SLA-breach penalty: 10% per extra TAT day, capped at 100%. */
const PENALTY_PERCENT_PER_DAY = 10
const MAX_PENALTY_PERCENT = 100

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function toCoord(value: unknown): number {
  return typeof value === "number" ? value : Number(String(value ?? "").trim())
}

export function processBilling(
  rows: TripStatusRow[],
  params: BillingParams
): { rows: BillingRow[]; summary: BillSummary } {
  const holidays = new Set(params.holidays)
  const summary: BillSummary = {
    totalRows: rows.length,
    billed: 0,
    classification: { in: 0, out: 0, remote: 0 },
    invalidCoordinates: 0,
    tatUnavailable: 0,
    submissionMissing: 0,
    unclassified: 0,
    totalAmount: 0,
  }

  type ClassifyOutcome = Zone | null | typeof INVALID_COORDINATES_MARKER

  interface ClassifyResult {
    outcome: ClassifyOutcome
    /** Human-readable audit trail of the isochrone matches for this row. */
    comparison: string | null
  }

  /**
   * Dhaka boundary validation + isochrone containment for one row. Returns
   * the final zone (null when the row cannot be classified, or a marker for
   * the invalid-coordinate case) plus the audit trail.
   */
  function classify(row: TripStatusRow): ClassifyResult {
    const existing = String(row.in_out_remote ?? "").trim().toUpperCase()
    if (existing !== "IN" && existing !== "OUT" && existing !== "REMOTE") {
      return { outcome: null, comparison: null }
    }

    // Step 0 — the IN test against the Dhaka city corporation boundary
    // (data/dhaka_city_corporation.geojson). Coordinates inside the boundary
    // are IN no matter what the backend claimed; a claimed-IN row that fails
    // the boundary test is rejected and continues through the isochrone
    // steps below, which can only produce OUT or REMOTE.
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

    // Orgs without a current isochrone dataset: no reclassification — the
    // backend's OUT/REMOTE stands: the rule set belongs to the isochrone
    // dataset, so orgs without one get the backend's verdict verbatim. A
    // rejected IN claim has no backend OUT/REMOTE verdict to keep and no
    // rule set to reclassify with, so it is left unbilled (unclassified)
    // with the rejection noted instead of being guessed.
    if (params.isochrones.length === 0) {
      if (existing === "IN") {
        return {
          outcome: null,
          comparison: withPrefix(
            "organization has no branch isochrone dataset to reclassify with"
          ),
        }
      }
      const kept: Zone = existing === "OUT" ? "OUT" : "REMOTE"
      return {
        outcome: kept,
        comparison:
          "organization has no branch isochrone dataset; backend classification kept",
      }
    }

    // Coordinates are mandatory from here on: containment needs them. For
    // claimed OUT/REMOTE rows this is the pre-existing check; a rejected IN
    // claim lands here too when its coordinates cannot be validated.
    if (!coordsValid) {
      return { outcome: INVALID_COORDINATES_MARKER, comparison: auditPrefix }
    }

    // Step 1 — Dhaka district test (data/dhaka_district.geojson): a point
    // inside the district but outside the city corporation (IN cases were
    // already decided in step 0) is OUT outright — no branch isochrone
    // needed.
    if (isInsideDhakaDistrict(lat, lon)) {
      return {
        outcome: "OUT",
        comparison: withPrefix(
          "coordinates inside the Dhaka district boundary"
        ),
      }
    }

    // Step 2 — branch isochrone fallback: IN comes solely from the Dhaka
    // city corporation boundary (step 0), so the branch category plays no
    // part here either. A point outside the district but inside any branch's
    // isochrone (either category) is OUT — within a station's service range;
    // a point in neither is REMOTE. Every match is listed for the audit.
    const matches = findIsochroneMatches(params.isochrones, lat, lon)
    const audit = withPrefix(
      matches.length > 0
        ? matches.map((m) => `${m.branchName} [${m.category}]`).join("; ")
        : "NO_ISOCHRONE_MATCH"
    )
    if (matches.length > 0) {
      return { outcome: "OUT", comparison: audit }
    }
    return { outcome: "REMOTE", comparison: audit }
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
    const submission = parseDateTimeSerial(row["SubmissionDateTime"])
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

  function processRow(row: TripStatusRow): void {
    const billingRow = row as BillingRow
    billingRow["Submission Date"] = null
    billingRow["Rate"] = null
    billingRow["TAT Days"] = null
    billingRow["TAT Extra"] = null
    billingRow["Penalty"] = null
    billingRow["Price After Penalty"] = null
    billingRow["Compared Branches And Distances"] = null
    billingRow["Attention Needed"] = null

    // A null SubmissionDateTime means the backend never recorded a
    // submission: TAT (and therefore billing) is not computable. Skip the
    // whole calculation — the row stays unbilled with the backend's
    // classification untouched — and surface the count on the summary sheet.
    if (String(row.SubmissionDateTime ?? "").trim() === "") {
      summary.submissionMissing++
      return
    }

    const { outcome: zone, comparison } = classify(row)
    billingRow["Compared Branches And Distances"] = comparison

    if (zone === null) {
      summary.unclassified++
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

  for (const row of rows) {
    processRow(row)
  }

  summary.totalAmount = round2(summary.totalAmount)
  return { rows: rows as BillingRow[], summary }
}
