// The Branch shape of the bundled data/*_branches.json files. Which ORG owns
// which branch dataset is decided in org-branches.ts; the branch isochrones
// generated from these files are loaded in isochrones.ts.

export interface Branch {
  id: number
  branch_name: string
  /** Branch's own serving radius in km — also the isochrone generation radius. */
  max_distance_km: number
  district: string
  area: string
  division: string | null
  address: string
  lat: number
  lon: number
  /** "in" = inside-Dhaka branch, "out" = upcountry branch. */
  category: "in" | "out"
}
