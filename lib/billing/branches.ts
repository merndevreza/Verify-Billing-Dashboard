// Bank branch data + district matching for the Out/Remote classification.
//
// The branch list is bundled from data/brac_branches.json (typed below with
// the ACTUAL property names in that file: max_distance_km, lon, category).

import branchData from "@/data/brac_branches.json"

export interface Branch {
  id: number
  branch_name: string
  /** Branch's own serving radius in km — road distance must be ≤ this for OUT. */
  max_distance_km: number
  district: string
  area: string
  division: string | null
  address: string
  lat: number
  lon: number
  /** "in" = inside-Dhaka branch, "out" = branch eligible for the road-distance check. */
  category: "in" | "out"
}

export const BRANCHES = branchData as Branch[]

/** Lowercase, strip everything non-alphanumeric: "Cox's Bazar" → "coxsbazar". */
export function normalizeName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
}

/**
 * Known district spelling variants → the spelling used in brac_branches.json
 * (after normalizeName). Prevents a benign rename ("Bogura"/"Bogra") from
 * silently reclassifying every trip of that district as Remote.
 */
const DISTRICT_ALIASES: Record<string, string> = {
  bogura: "bogra",
  jashore: "jessore",
  chittagong: "chattogram",
  barisal: "barishal",
  comilla: "cumilla",
  munshiganj: "munshigonj",
  lakshmipur: "laxmipur",
  sunamganj: "sunamgonj",
  netrakona: "netrokona",
}

function canonicalDistrict(district: unknown): string {
  const norm = normalizeName(district)
  return DISTRICT_ALIASES[norm] ?? norm
}

/** district → eligible branches (category "out" only), built once per process. */
const branchesByDistrict = new Map<string, Branch[]>()
for (const branch of BRANCHES) {
  if (branch.category !== "out") continue
  const key = canonicalDistrict(branch.district)
  const list = branchesByDistrict.get(key)
  if (list) list.push(branch)
  else branchesByDistrict.set(key, [branch])
}

/**
 * Eligible branches (category "out") for a trip's District column value.
 * null when the trip has no district — distinct from "district has no branch".
 */
export function branchesForDistrict(tripDistrict: unknown): Branch[] | null {
  if (!String(tripDistrict ?? "").trim()) return null
  return branchesByDistrict.get(canonicalDistrict(tripDistrict)) ?? []
}

/**
 * True for Dhaka-district trips. All Dhaka branches are category "in", so
 * confirmed business rule: any Dhaka-district trip that is not inside the
 * metro is OUT — it never goes through branch distance checks.
 */
export function isDhakaDistrict(tripDistrict: unknown): boolean {
  return canonicalDistrict(tripDistrict) === "dhaka"
}

/**
 * Step A — District Sadar check: does the address contain the district name
 * followed by the word "Sadar"? Normalization makes "Rajshahi Sadar-Kazla"
 * and "COX'S BAZAR SADAR" both match their district spellings.
 */
export function isDistrictSadarAddress(
  tripDistrict: unknown,
  address: unknown
): boolean {
  const district = normalizeName(tripDistrict)
  if (!district) return false
  const addr = normalizeName(address)
  return addr.includes(district + "sadar")
}
