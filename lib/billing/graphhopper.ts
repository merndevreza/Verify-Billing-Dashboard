// GraphHopper (graphhopper-bd) client — motorcycle road distances for the
// Out/Remote classification. Field reps ride motorcycles, so distances come
// from the `motorcycle` profile (Bangladesh-tuned custom model in
// graphhopper-bd/custom_models/motorcycle_bd.json), never straight-line.
//
// Rural trip ends sometimes sit beyond GraphHopper's snap reach (~2 km) when
// the surrounding roads are missing or disconnected in the OSM data — the
// server answers "Cannot find point N". For those rows the client falls back
// to a hybrid estimate: route between the nearest drivable point it can find
// and the other endpoint, then add the remaining straight-line gap inflated
// by a 20% detour factor (approximates the unmapped last leg riding distance).

import type { RouteDistanceResult } from "./types"

const BASE_URL = (process.env.GRAPHHOPPER_URL ?? "http://localhost:8989").replace(
  /\/+$/,
  ""
)
const PROFILE = "motorcycle"
const TIMEOUT_MS = 15_000
const RETRIES = 1

/** Straight-line gap inflation for the hybrid fallback (business-approved). */
const GAP_DETOUR_FACTOR = 1.2
/** Ring-search radii in meters when hunting the nearest drivable point. */
const PROBE_OFFSETS_M = [50, 100, 200, 350, 550, 800, 1100, 1500, 2000, 2600, 3300]
/** Bearings per ring — 8 directions is enough to catch a road 1–3 km away. */
const PROBE_BEARINGS = 8
/** GraphHopper errors the hybrid can fix: unsnappable endpoint or disconnected pair. */
const SNAP_ERROR_RE = /cannot find point \d|connection between points not found/i

/** Result of a hybrid estimate: meters plus the human-readable how/why. */
interface HybridResult extends RouteDistanceResult {
  estimated: true
}

/** Provider identity for run archives — barikoi-routing.ts defines its own. */
export const ROUTER_PROVIDER = "graphhopper"

export class RouteDistanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RouteDistanceError"
  }
}

/** Great-circle distance between two lat/lon points in meters. */
export function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6_371_008.8
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

interface RouteAnswer {
  distance: number
  /** Where point 0 / point 1 actually landed on the road graph (lat, lon). */
  snappedStart: [number, number] | null
  snappedEnd: [number, number] | null
}

async function fetchRoute(
  start: [number, number],
  end: [number, number]
): Promise<RouteAnswer> {
  const p = (point: [number, number]) =>
    `point=${encodeURIComponent(`${point[0]},${point[1]}`)}`
  const query = `${p(start)}&${p(end)}&profile=${PROFILE}&instructions=false&points_encoded=false&locale=en`

  const response = await fetch(`${BASE_URL}/route?${query}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  })
  if (!response.ok) {
    // GraphHopper puts the useful detail ("Cannot find point 0: …") in the
    // JSON body — keep it so callers can tell snap failures from outages.
    let message = `GraphHopper /route responded ${response.status}`
    try {
      const body = (await response.json()) as { message?: unknown }
      if (typeof body.message === "string") message += `: ${body.message}`
    } catch {
      // non-JSON error body — the status line is all we have
    }
    throw new RouteDistanceError(message)
  }
  const data = (await response.json()) as {
    paths?: {
      distance?: number
      points?: { coordinates?: [number, number][] }
    }[]
  }
  const path = data.paths?.[0]
  const distance = path?.distance
  if (typeof distance !== "number" || !Number.isFinite(distance)) {
    throw new RouteDistanceError("GraphHopper /route returned no distance")
  }
  const coords = path?.points?.coordinates ?? []
  const first = coords[0]
  const last = coords[coords.length - 1]
  return {
    distance,
    // GeoJSON order is [lon, lat]; our points are [lat, lon].
    snappedStart: first ? [first[1], first[0]] : null,
    snappedEnd: last ? [last[1], last[0]] : null,
  }
}

/** Offset a lat/lon by meters along a compass bearing (small-distance approx). */
function offsetPoint(
  point: [number, number],
  meters: number,
  bearingRad: number
): [number, number] {
  const mPerDegLat = 111_320
  const mPerDegLon = 111_320 * Math.cos((point[0] * Math.PI) / 180)
  return [
    point[0] + (meters * Math.cos(bearingRad)) / mPerDegLat,
    point[1] + (meters * Math.sin(bearingRad)) / mPerDegLon,
  ]
}

/**
 * Hybrid fallback for a failed route: ring-search around `moving` for the
 * nearest point that still routes to `fixed`, then return that road distance
 * plus the air-gap back to the real endpoint inflated by GAP_DETOUR_FACTOR.
 * `side` is which endpoint (0 = start, 1 = end) is being re-anchored.
 * Returns null when nothing within PROBE_OFFSETS_M routes — the pair is
 * genuinely unreachable and the caller should keep failing the row.
 */
async function hybridEstimate(
  moving: [number, number],
  fixed: [number, number],
  side: 0 | 1
): Promise<HybridResult | null> {
  for (const offset of PROBE_OFFSETS_M) {
    for (let b = 0; b < PROBE_BEARINGS; b++) {
      const bearing = (2 * Math.PI * b) / PROBE_BEARINGS
      const anchor = offsetPoint(moving, offset, bearing)
      const from = side === 0 ? anchor : fixed
      const to = side === 0 ? fixed : anchor
      try {
        const answer = await fetchRoute(from, to)
        const snapped = side === 0 ? answer.snappedStart : answer.snappedEnd
        if (!snapped) continue
        const gap = haversineM(moving[0], moving[1], snapped[0], snapped[1])
        const label = side === 0 ? "trip end" : "branch"
        return {
          meters: answer.distance + gap * GAP_DETOUR_FACTOR,
          estimated: true,
          note:
            `${label} is ~${(gap / 1000).toFixed(2)} km off the mapped road graph; ` +
            `distance estimated as motorcycle route from the nearest drivable ` +
            `point (${snapped[0].toFixed(5)}, ${snapped[1].toFixed(5)}) + air distance × 1.2`,
        }
      } catch {
        // candidate sits off-network or is unreachable — try the next bearing
      }
    }
  }
  return null
}

/** Which endpoint failed to snap, from GraphHopper's "Cannot find point N". */
function failedSide(message: string): 0 | 1 {
  const match = message.match(/cannot find point (\d)/i)
  return match?.[1] === "1" ? 1 : 0
}

/**
 * Motorcycle road distance between two points. Exact road distance when
 * GraphHopper can snap both endpoints; when one endpoint cannot snap (rural
 * trip ends off the mapped road graph), a hybrid estimate: route from the
 * nearest drivable point + air-gap × 1.2, flagged via `estimated`/`note` so
 * the report can mark the row for manual check. Throws RouteDistanceError
 * only when no route at all can be calculated — callers decide per business
 * rule (skip the row, never guess a classification).
 */
export async function routeDistanceM(
  start: [number, number],
  end: [number, number]
): Promise<RouteDistanceResult> {
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return {
        meters: (await fetchRoute(start, end)).distance,
        estimated: false,
        note: "",
      }
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      // Snap failures are deterministic — retrying won't help, go hybrid.
      if (SNAP_ERROR_RE.test(message)) break
      if (attempt < RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : String(lastError)
  if (SNAP_ERROR_RE.test(message)) {
    const preferred = failedSide(message)
    const sides: (0 | 1)[] = preferred === 0 ? [0, 1] : [1, 0]
    for (const side of sides) {
      const estimate = await hybridEstimate(
        side === 0 ? start : end,
        side === 0 ? end : start,
        side
      )
      if (estimate !== null) return estimate
    }
  }
  throw new RouteDistanceError(message)
}
