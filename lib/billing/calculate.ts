// Core billing engine: classification (Rule 2 + 11), TAT (Rule 4, 5, 11.A),
// penalty (Rule 6) and final price (Rule 7). Runs on the parsed trip rows in
// place — no row copies — and routes Out/Remote candidates through the
// selected routing provider (see import below) with caching, a straight-line
// prefilter, nearest-first early exit and bounded concurrency.

import {
  branchesForDistrict,
  districtBranchIndex,
  isDistrictSadarAddress,
  isDhakaDistrict,
  type Branch,
} from "./branches"
import {
  countHolidaysBetween,
  diffCalendarDays,
  parseCalendarDate,
} from "./dates"
// Routing provider — pick ONE by commenting the other out.
// 1. graphhopper: self-hosted GraphHopper (graphhopper-bd docker, GRAPHHOPPER_URL)
// 2. barikoi-routing: Barikoi routing API (needs BARIKOI_API_KEY in .env)
import { haversineM, routeDistanceM } from "./graphhopper"
//import { haversineM, routeDistanceM } from "./barikoi-routing"
import type { BillSummary, BillingRow, TripStatusRow } from "./types"

export interface BillingParams {
  rates: { inStation: number; outStation: number; remote: number }
  penalties: {
    day1: number
    day2: number
    day3: number
    day4: number
    day5: number
    day6: number
    day7: number
  }
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

/** Penalties are defined for up to 7 extra days; beyond that day7 applies. */
const MAX_PENALTY_EXTRA_DAYS = 7
const ROUTE_CONCURRENCY = 8
/** Consecutive route failures before the router is treated as down for the rest of the run. */
const ROUTE_BREAKER_THRESHOLD = 30
/** ~11 m — coordinate rounding for the route cache key. */
const CACHE_PRECISION = 4

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

const PENALTY_KEYS = [
  "day1",
  "day2",
  "day3",
  "day4",
  "day5",
  "day6",
  "day7",
] as const

function penaltyPercentFor(
  extraDays: number,
  penalties: BillingParams["penalties"]
): number {
  if (extraDays <= 0) return 0
  const day = Math.min(extraDays, MAX_PENALTY_EXTRA_DAYS)
  return penalties[PENALTY_KEYS[day - 1]]
}

function toCoord(value: unknown): number {
  return typeof value === "number" ? value : Number(String(value ?? "").trim())
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

  const routeCache = new Map<string, number>()
  let routeFailStreak = 0
  let routerDown = false

  async function routeWithCache(
    trip: [number, number],
    branch: Branch
  ): Promise<number> {
    const key = `${branch.id}:${trip[0].toFixed(CACHE_PRECISION)},${trip[1].toFixed(CACHE_PRECISION)}`
    const cached = routeCache.get(key)
    if (cached !== undefined) return cached
    const distance = await routeDistanceM(trip, [branch.lat, branch.lon])
    routeCache.set(key, distance)
    return distance
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
  }

  /**
   * Rule 2 + 11 for one row. Returns the final zone (null when the original
   * classification is not IN/OUT/REMOTE, or a marker for the failure cases)
   * plus the branch-comparison audit trail.
   */
  async function classify(row: TripStatusRow): Promise<ClassifyResult> {
    const existing = String(row.in_out_remote ?? "").trim().toUpperCase()

    // Rule 1 — In stays In, no distance check.
    if (existing === "IN") return { outcome: "IN", comparison: null }
    if (existing !== "OUT" && existing !== "REMOTE") {
      return { outcome: null, comparison: null }
    }

    // Step A — District Sadar check, no routing.
    if (isDistrictSadarAddress(row.District, row.Address)) {
      return {
        outcome: "OUT",
        comparison: "district-sadar address; no branch check",
      }
    }

    // Orgs without a bundled branch dataset: no reclassification — the
    // backend's OUT/REMOTE stands (existing is OUT or REMOTE here).
    if (params.branches.length === 0) {
      return {
        outcome: existing as Zone,
        comparison:
          "organization has no branch dataset; backend classification kept",
      }
    }

    // Confirmed rule: Dhaka-district trips are outside the metro here (inside
    // metro ones stay IN via Rule 1) — they are always OUT, no branch check.
    if (isDhakaDistrict(row.District)) {
      return { outcome: "OUT", comparison: "Dhaka district; no branch check" }
    }

    // Step B — eligible branches for this district (category "out" only).
    const districtBranches = branchesForDistrict(row.District, districtIndex) ?? []
    if (districtBranches.length === 0) {
      // Rule 11.B
      return {
        outcome: "REMOTE",
        comparison: `no eligible branch for district "${row.District}"`,
      }
    }

    const lat = toCoord(row.Latitude)
    const lon = toCoord(row.Longitude)
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      (lat === 0 && lon === 0)
    ) {
      return { outcome: INVALID_COORDINATES_MARKER, comparison: null }
    }

    // Straight-line prefilter: road distance ≥ straight-line, so a branch
    // whose own radius is already exceeded by the straight line can never
    // classify the trip as OUT — skipping its route call is lossless.
    // Survivors are checked nearest-first: the first branch that fits its own
    // radius settles the trip as OUT, so ordering by straight line makes the
    // early exit as fast as possible.
    const comparisons: string[] = []
    const candidates: { branch: Branch; straightKm: number }[] = []
    for (const branch of districtBranches) {
      const straightKm = haversineM(lat, lon, branch.lat, branch.lon) / 1000
      if (straightKm <= branch.max_distance_km) {
        candidates.push({ branch, straightKm })
      } else {
        comparisons.push(
          `${branch.branch_name}: straight-line ${straightKm.toFixed(2)} km > ${branch.max_distance_km} km limit, not routed`
        )
      }
    }
    if (candidates.length === 0) {
      return { outcome: "REMOTE", comparison: comparisons.join("; ") }
    }
    candidates.sort((a, b) => a.straightKm - b.straightKm)

    if (routerDown) {
      for (const { branch } of candidates) {
        comparisons.push(`${branch.branch_name}: not attempted, router down`)
      }
      return { outcome: ROUTE_UNAVAILABLE_MARKER, comparison: comparisons.join("; ") }
    }

    // Step C/D — motorcycle road distance per candidate. OUT as soon as ANY
    // candidate fits within its own radius (the remaining ones are not
    // measured); REMOTE only after EVERY candidate was measured and exceeded
    // its radius. Any failed/unmeasured candidate → Rule 11.C marker, never
    // a guessed REMOTE.
    let measured = 0
    let anyFailed = false
    for (let i = 0; i < candidates.length; i++) {
      const { branch } = candidates[i]
      try {
        const distance = await routeWithCache([lat, lon], branch)
        routeFailStreak = 0
        measured++
        const km = distance / 1000
        if (km <= branch.max_distance_km) {
          const earlyExit =
            i < candidates.length - 1
              ? ", remaining branches not routed"
              : ""
          comparisons.push(
            `${branch.branch_name}: ${km.toFixed(2)} km ≤ ${branch.max_distance_km} km limit${earlyExit}`
          )
          return { outcome: "OUT", comparison: comparisons.join("; ") }
        }
        comparisons.push(
          `${branch.branch_name}: ${km.toFixed(2)} km > ${branch.max_distance_km} km limit`
        )
      } catch {
        routeFailStreak++
        if (routeFailStreak >= ROUTE_BREAKER_THRESHOLD) routerDown = true
        anyFailed = true
        comparisons.push(`${branch.branch_name}: route failed`)
      }
    }
    return measured === candidates.length && !anyFailed
      ? { outcome: "REMOTE", comparison: comparisons.join("; ") }
      : {
          outcome: ROUTE_UNAVAILABLE_MARKER,
          comparison: comparisons.join("; "),
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

    const receiveISO = parseCalendarDate(row["Receive Date"])
    const verifyISO = parseCalendarDate(row.VerificationDateTime)
    if (!receiveISO || !verifyISO) return false

    const tatDays =
      diffCalendarDays(receiveISO, verifyISO) +
      1 -
      countHolidaysBetween(receiveISO, verifyISO, holidays)
    const tatExtra = Math.max(0, tatDays - EXPECTED_DAYS[zone])
    const penalty = penaltyPercentFor(tatExtra, params.penalties)
    row["TAT Days"] = tatDays
    row["TAT Extra"] = tatExtra
    row["Penalty"] = penalty
    row["Price After Penalty"] = round2((rate * (100 - penalty)) / 100)
    return true
  }

  async function processRow(row: TripStatusRow): Promise<void> {
    const billingRow = row as BillingRow
    billingRow["Rate"] = null
    billingRow["TAT Days"] = null
    billingRow["TAT Extra"] = null
    billingRow["Penalty"] = null
    billingRow["Price After Penalty"] = null
    billingRow["Compared Branches And Distances"] = null

    const { outcome: zone, comparison } = await classify(row)
    billingRow["Compared Branches And Distances"] = comparison

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
