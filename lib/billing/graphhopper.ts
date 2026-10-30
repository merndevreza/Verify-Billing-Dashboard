// GraphHopper (graphhopper-bd) client — motorcycle road distances for the
// Out/Remote classification. Field reps ride motorcycles, so distances come
// from the `motorcycle` profile (Bangladesh-tuned custom model in
// graphhopper-bd/custom_models/motorcycle_bd.json), never straight-line.

const BASE_URL = (process.env.GRAPHHOPPER_URL ?? "http://localhost:8989").replace(
  /\/+$/,
  ""
)
const PROFILE = "motorcycle"
const TIMEOUT_MS = 15_000
const RETRIES = 1

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
  const p = (point: [number, number]) =>
    `point=${encodeURIComponent(`${point[0]},${point[1]}`)}`
  const query = `${p(start)}&${p(end)}&profile=${PROFILE}&instructions=false&locale=en`

  const response = await fetch(`${BASE_URL}/route?${query}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  })
  if (!response.ok) {
    throw new RouteDistanceError(
      `GraphHopper /route responded ${response.status}`
    )
  }
  const data = (await response.json()) as {
    paths?: { distance?: number }[]
  }
  const distance = data.paths?.[0]?.distance
  if (typeof distance !== "number" || !Number.isFinite(distance)) {
    throw new RouteDistanceError("GraphHopper /route returned no distance")
  }
  return distance
}

/**
 * Motorcycle road distance in meters between two points.
 * Throws RouteDistanceError when the route cannot be calculated — callers
 * decide per business rule (skip the row, never guess a classification).
 */
export async function routeDistanceM(
  start: [number, number],
  end: [number, number]
): Promise<number> {
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await routeOnce(start, end)
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
