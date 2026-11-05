// Shared GeoJSON point-in-polygon helpers, used by the Dhaka boundary check
// and the branch isochrone containment check. Coordinates are [lon, lat] —
// GeoJSON order.

/** [lon, lat] pair — GeoJSON coordinate order. */
export type Position = [number, number]
/** Ring 0 is the exterior, later rings are holes (resolved by even-odd). */
export type Ring = Position[]

export interface PolygonBounds {
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

/** Bounding box over a ring's positions. */
export function ringBounds(ring: Ring): PolygonBounds {
  const bounds: PolygonBounds = {
    minLon: Infinity,
    minLat: Infinity,
    maxLon: -Infinity,
    maxLat: -Infinity,
  }
  for (const [lon, lat] of ring) {
    if (lon < bounds.minLon) bounds.minLon = lon
    if (lon > bounds.maxLon) bounds.maxLon = lon
    if (lat < bounds.minLat) bounds.minLat = lat
    if (lat > bounds.maxLat) bounds.maxLat = lat
  }
  return bounds
}

/** Union bounding box over a polygon's rings. */
export function ringsBounds(rings: Ring[]): PolygonBounds {
  const bounds: PolygonBounds = {
    minLon: Infinity,
    minLat: Infinity,
    maxLon: -Infinity,
    maxLat: -Infinity,
  }
  for (const ring of rings) {
    const ringBox = ringBounds(ring)
    if (ringBox.minLon < bounds.minLon) bounds.minLon = ringBox.minLon
    if (ringBox.maxLon > bounds.maxLon) bounds.maxLon = ringBox.maxLon
    if (ringBox.minLat < bounds.minLat) bounds.minLat = ringBox.minLat
    if (ringBox.maxLat > bounds.maxLat) bounds.maxLat = ringBox.maxLat
  }
  return bounds
}

/** Cheap rejection test: is (lon, lat) within the bounding box? */
export function boundsContain(
  bounds: PolygonBounds,
  lon: number,
  lat: number
): boolean {
  return (
    lon >= bounds.minLon &&
    lon <= bounds.maxLon &&
    lat >= bounds.minLat &&
    lat <= bounds.maxLat
  )
}

/** Even-odd ray cast: is (lon, lat) inside this ring? */
export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
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

/** Even-odd across the rings: inside the exterior and not in a hole. */
export function pointInPolygon(
  lon: number,
  lat: number,
  rings: Ring[]
): boolean {
  let inside = false
  for (const ring of rings) {
    if (pointInRing(lon, lat, ring)) inside = !inside
  }
  return inside
}
