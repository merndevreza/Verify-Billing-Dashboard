// Zone boundary polygons (data/*.geojson) — sources of truth for the zone
// tests: inside the Dhaka city corporation polygon is IN no matter what the
// backend claimed, inside the Dhaka district polygon is OUT, inside any
// district sadar sub-district is OUT, and only after all three does the
// branch-isochrone fallback run. Each file is read from disk once per
// process and cached (same cwd idiom as storage.ts), so a replaced boundary
// file is picked up on server restart without a rebuild.

import { readFileSync } from "node:fs"
import path from "node:path"
import {
  boundsContain,
  pointInPolygon,
  ringsBounds,
  type Ring,
} from "./point-in-polygon"

interface BoundaryPolygon {
  rings: Ring[]
  bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number }
}

const cache = new Map<string, BoundaryPolygon[]>()

/** Parse + cache one boundary file; fails loudly on a bad/empty file. */
function loadBoundary(file: string): BoundaryPolygon[] {
  const cached = cache.get(file)
  if (cached) return cached
  const parsed = JSON.parse(
    readFileSync(path.join(process.cwd(), "data", file), "utf8")
  ) as {
    features?: {
      geometry?: { type?: string; coordinates?: unknown }
    }[]
  }

  const polygons: BoundaryPolygon[] = []
  for (const feature of parsed.features ?? []) {
    const geometry = feature.geometry
    if (!geometry) continue
    // Polygon and MultiPolygon are both accepted so a future boundary file
    // can carry several polygons or holes without changes here.
    const coordinates =
      geometry.type === "Polygon"
        ? [geometry.coordinates as Ring[]]
        : geometry.type === "MultiPolygon"
          ? (geometry.coordinates as Ring[][])
          : null
    if (!coordinates) continue

    for (const rings of coordinates) {
      // A ring with fewer than 4 positions (3 vertices + closing point)
      // cannot enclose area — skip it.
      const validRings = rings.filter((ring) => ring.length >= 4)
      if (validRings.length > 0) {
        polygons.push({ rings: validRings, bounds: ringsBounds(validRings) })
      }
    }
  }

  if (polygons.length === 0) {
    throw new Error(`data/${file} contains no polygon geometries`)
  }
  cache.set(file, polygons)
  return polygons
}

/** Containment test against one boundary file's polygons. */
function insideFile(file: string, lat: number, lon: number): boolean {
  for (const polygon of loadBoundary(file)) {
    if (!boundsContain(polygon.bounds, lon, lat)) continue
    // Even-odd across the rings: inside the exterior and not in a hole.
    if (pointInPolygon(lon, lat, polygon.rings)) return true
  }
  return false
}

/** True when (lat, lon) falls inside the Dhaka city corporation boundary. */
export function isInsideDhakaBoundary(lat: number, lon: number): boolean {
  return insideFile("dhaka_city_corporation.geojson", lat, lon)
}

/** True when (lat, lon) falls inside the Dhaka district boundary. */
export function isInsideDhakaDistrict(lat: number, lon: number): boolean {
  return insideFile("dhaka_district.geojson", lat, lon)
}

/**
 * True when (lat, lon) falls inside any district sadar sub-district
 * (data/sadar_sub_district.geojson) — sadar trips can never be REMOTE.
 */
export function isInsideSadarSubDistrict(lat: number, lon: number): boolean {
  return insideFile("sadar_sub_district.geojson", lat, lon)
}
