// Barikoi routing API client — motorcycle road distances for the Out/Remote
// classification. Drop-in alternative to graphhopper.ts: both files export the
// same interface (routeDistanceM returning RouteDistanceResult, haversineM,
// RouteDistanceError), so calculate.ts can switch providers by swapping one
// import. This provider has no hybrid fallback — it always returns exact
// distances (estimated: false) or throws.
//
// API: POST https://barikoi.xyz/v2/api/routing?key=<API_KEY>&type=vh&profile=motorcycle
// Docs: https://docs.barikoi.com/api-integrated (route_with_routing_algorithm)
// Response: Valhalla-style — trip.summary.length is the total distance in km.

import type { RouteDistanceResult } from "./types"

const BASE_URL = "https://barikoi.xyz"
const PROFILE = "motorcycle"
const TIMEOUT_MS = 30_000
const RETRIES = 3

/** Provider identity for run archives — graphhopper.ts defines its own. */
export const ROUTER_PROVIDER = "barikoi"

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

async function routeOnce(
  start: [number, number],
  end: [number, number]
): Promise<number> {
  const apiKey = process.env.BARIKOI_API_KEY
  if (!apiKey) {
    throw new RouteDistanceError(
      "BARIKOI_API_KEY is not set — required for the Barikoi routing provider"
    )
  }

  const url = `${BASE_URL}/v2/api/routing?key=${encodeURIComponent(apiKey)}&type=vh&profile=${PROFILE}`
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: {
        start: { latitude: start[0], longitude: start[1] },
        destination: { latitude: end[0], longitude: end[1] },
      },
    }), 
    cache: "no-store",
  })

  if (!response.ok) {
    throw new RouteDistanceError(
      `Barikoi routing responded ${response.status}`
    )
  }

  const data = (await response.json()) as {
    trip?: {
      units?: string
      summary?: { length?: number }
    }
  }
  // The API may return miles or km depending on the request; normalise to km.
  const rawDist = data.trip?.summary?.length
  const isMiles = (data.trip?.units ?? "").toLowerCase().startsWith("mi")
  const km = rawDist != null ? (isMiles ? rawDist * 1.60934 : rawDist) : undefined
  if (typeof km !== "number" || !Number.isFinite(km) || km <= 0) {
    throw new RouteDistanceError("Barikoi routing returned no distance")
  }
  return km * 1000
}

/**
 * Motorcycle road distance in meters between two points (same contract as
 * graphhopper.ts). Throws RouteDistanceError when the route cannot be
 * calculated — callers decide per business rule (skip the row, never guess).
 */
export async function routeDistanceM(
  start: [number, number],
  end: [number, number]
): Promise<RouteDistanceResult> {
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return {
        meters: await routeOnce(start, end),
        estimated: false,
        note: "",
      }
    } catch (error) {
      lastError = error
      if (attempt < RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
  }
  throw new RouteDistanceError(
    lastError instanceof Error ? lastError.message : String(lastError)
  )
}
