// Branch domain logic for the Out/Remote classification: the Branch shape,
// district matching and address heuristics. Which ORG owns which branch
// dataset is decided in org-branches.ts, not here.

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

/**
 * district → eligible branches (category "out" only) for one org's dataset.
 * Build once per run and pass the index to branchesForDistrict().
 */
export function districtBranchIndex(branches: Branch[]): Map<string, Branch[]> {
  const index = new Map<string, Branch[]>()
  for (const branch of branches) {
    if (branch.category !== "out") continue
    const key = canonicalDistrict(branch.district)
    const list = index.get(key)
    if (list) list.push(branch)
    else index.set(key, [branch])
  }
  return index
}

/**
 * Eligible branches (category "out") for a trip's District column value.
 * null when the trip has no district — distinct from "district has no branch".
 */
export function branchesForDistrict(
  tripDistrict: unknown,
  index: Map<string, Branch[]>
): Branch[] | null {
  if (!String(tripDistrict ?? "").trim()) return null
  return index.get(canonicalDistrict(tripDistrict)) ?? []
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
