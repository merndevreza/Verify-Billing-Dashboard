// Dhaka city corporation boundary (data/dhaka.geojson) — the source of truth
// for the IN-station test: a trip whose coordinates fall inside this polygon
// is IN no matter what the backend claimed. The file is read from disk once
// per process and cached (same cwd idiom as storage.ts), so a replaced
// boundary file is picked up on server restart without a rebuild.

import { readFileSync } from "node:fs"
import path from "node:path"

/** [lon, lat] pair — GeoJSON coordinate order. */
type Position = [number, number]
/** Ring 0 is the exterior, later rings are holes (resolved by even-odd). */
type Ring = Position[]

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
        ? [geometry.coordinates as Position[][]]
        : geometry.type === "MultiPolygon"
          ? (geometry.coordinates as Position[][][])
          : null
    if (!coordinates) continue

    for (const rings of coordinates) {
      const polygon: BoundaryPolygon = {
        rings: [],
        bounds: {
          minLon: Infinity,
          minLat: Infinity,
          maxLon: -Infinity,
          maxLat: -Infinity,
        },
      }
      for (const ring of rings) {
        // A ring with fewer than 4 positions (3 vertices + closing point)
        // cannot enclose area — skip it.
        if (ring.length < 4) continue
        polygon.rings.push(ring)
        for (const [lon, lat] of ring) {
          if (lon < polygon.bounds.minLon) polygon.bounds.minLon = lon
          if (lon > polygon.bounds.maxLon) polygon.bounds.maxLon = lon
          if (lat < polygon.bounds.minLat) polygon.bounds.minLat = lat
          if (lat > polygon.bounds.maxLat) polygon.bounds.maxLat = lat
        }
      }
      if (polygon.rings.length > 0) polygons.push(polygon)
    }
  }

  if (polygons.length === 0) {
    throw new Error("data/dhaka.geojson contains no polygon geometries")
  }
  cache = polygons
  return polygons
}

/** Even-odd ray cast: is (lat, lon) inside this ring? */
function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (
      (yi > lat) !== (yj > lat) &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside
    }
  }
  return inside
}

/** True when (lat, lon) falls inside the Dhaka city corporation boundary. */
export function isInsideDhakaBoundary(lat: number, lon: number): boolean {
  let inside = false
  for (const polygon of loadBoundary()) {
    const bounds = polygon.bounds
    if (
      lon < bounds.minLon ||
      lon > bounds.maxLon ||
      lat < bounds.minLat ||
      lat > bounds.maxLat
    ) {
      continue
    }
    // Even-odd across the rings: inside the exterior and not in a hole.
    for (const ring of polygon.rings) {
      if (pointInRing(lon, lat, ring)) inside = !inside
    }
  }
  return inside
}
