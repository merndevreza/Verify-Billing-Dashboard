// Dhaka city corporation boundary (data/dhaka.geojson) — the source of truth
// for the IN-station test: a trip whose coordinates fall inside this polygon
// is IN no matter what the backend claimed. The file is read from disk once
// per process and cached (same cwd idiom as storage.ts), so a replaced
// boundary file is picked up on server restart without a rebuild.

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

let cache: BoundaryPolygon[] | null = null

/** Parse + cache the boundary polygons; fails loudly on a bad/empty file. */
function loadBoundary(): BoundaryPolygon[] {
  if (cache) return cache
  const file = JSON.parse(
    readFileSync(path.join(process.cwd(), "data", "dhaka.geojson"), "utf8")
  ) as {
    features?: {
      geometry?: { type?: string; coordinates?: unknown }
    }[]
  }

  const polygons: BoundaryPolygon[] = []
  for (const feature of file.features ?? []) {
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
    throw new Error("data/dhaka.geojson contains no polygon geometries")
  }
  cache = polygons
  return polygons
}

/** True when (lat, lon) falls inside the Dhaka city corporation boundary. */
export function isInsideDhakaBoundary(lat: number, lon: number): boolean {
  for (const polygon of loadBoundary()) {
    if (!boundsContain(polygon.bounds, lon, lat)) continue
    // Even-odd across the rings: inside the exterior and not in a hole.
    if (pointInPolygon(lon, lat, polygon.rings)) return true
  }
  return false
}
