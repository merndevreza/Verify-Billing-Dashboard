// Branch isochrones (data/<org>_branches_isochrones.geojson) — the source of
// truth for the OUT/REMOTE fallback: after the city corporation (IN) and
// district (OUT) boundary tests, a trip end point inside any branch's
// isochrone (either category) is OUT, and inside none is REMOTE. The branch
// category is carried only for the audit trail (see classify in
// calculate.ts). Each file is read
// from disk once per process and cached (same cwd idiom as dhaka-boundary.ts),
// so a regenerated file is picked up on server restart without a rebuild —
// the 3 MB file is never bundled via a static import.

import { readFileSync } from "node:fs"
import path from "node:path"
import {
  boundsContain,
  pointInPolygon,
  ringsBounds,
  type PolygonBounds,
  type Ring,
} from "./point-in-polygon"

/** One branch's isochrone polygon with its precomputed bounding box. */
export interface BranchIsochrone {
  branchName: string
  /** "in" branches are Dhaka stations, "out" branches are upcountry. */
  category: "in" | "out"
  rings: Ring[]
  bounds: PolygonBounds
}

/** A containment hit for one point: which branch's isochrone, which category. */
export interface IsochroneMatch {
  branchName: string
  category: "in" | "out"
}

interface IsochroneDataset {
  isochrones: BranchIsochrone[]
  /** Features skipped for being non-Polygon, malformed, or uncategorised. */
  skipped: number
}

const cache = new Map<string, IsochroneDataset>()

/** Polygon coordinates → valid rings (a ring needs 3 vertices + closing). */
function toRings(coordinates: unknown): Ring[] {
  if (!Array.isArray(coordinates)) return []
  return coordinates.filter(
    (ring): ring is Ring => Array.isArray(ring) && ring.length >= 4
  )
}

/**
 * Parse + cache one isochrone file; fails loudly when nothing usable remains —
 * silently classifying without a rule set would misbill.
 */
export function loadIsochrones(file: string): IsochroneDataset {
  const key = path.resolve(file)
  const cached = cache.get(key)
  if (cached) return cached

  const parsed = JSON.parse(
    readFileSync(path.join(process.cwd(), file), "utf8")
  ) as {
    type?: string
    features?: {
      properties?: { branch_id?: unknown; branch_name?: unknown; category?: unknown }
      geometry?: { type?: string; coordinates?: unknown }
    }[]
  }
  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error(`${file}: not a GeoJSON FeatureCollection`)
  }

  const isochrones: BranchIsochrone[] = []
  let skipped = 0
  for (const feature of parsed.features) {
    const category = feature.properties?.category
    if (category !== "in" && category !== "out") {
      skipped++
      continue
    }
    const rings = toRings(feature.geometry?.coordinates)
    if (rings.length === 0) {
      skipped++
      continue
    }
    const { branch_id: branchId, branch_name: branchName } =
      feature.properties ?? {}
    isochrones.push({
      branchName:
        typeof branchName === "string" && branchName.trim() !== ""
          ? branchName
          : branchId != null
            ? `branch #${String(branchId)}`
            : "unnamed branch",
      category,
      rings,
      bounds: ringsBounds(rings),
    })
  }

  if (isochrones.length === 0) {
    throw new Error(`${file}: contains no usable branch isochrone polygons`)
  }
  if (skipped > 0) {
    console.warn(
      `${file}: skipped ${skipped} feature(s) (non-Polygon, malformed rings, or missing category)`
    )
  }

  const dataset: IsochroneDataset = { isochrones, skipped }
  cache.set(key, dataset)
  return dataset
}

/**
 * All branch isochrones containing (lat, lon) — bounding-box pre-filter, then
 * ray-cast. No early exit: every match is reported for the audit trail.
 */
export function findIsochroneMatches(
  isochrones: BranchIsochrone[],
  lat: number,
  lon: number
): IsochroneMatch[] {
  const matches: IsochroneMatch[] = []
  for (const isochrone of isochrones) {
    if (!boundsContain(isochrone.bounds, lon, lat)) continue
    if (pointInPolygon(lon, lat, isochrone.rings)) {
      matches.push({
        branchName: isochrone.branchName,
        category: isochrone.category,
      })
    }
  }
  return matches
}
