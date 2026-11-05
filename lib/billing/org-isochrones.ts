// Org ↔ isochrone dataset registry. Reads data/org_registry.json, where every
// org can point at its bundled isochrone file (branches_isochrone) and flag
// it as current (isIsochroneUpdated); orgs without a current dataset never go
// through isochrone-based classification.

import orgRegistryFile from "@/data/org_registry.json"

/** Shape of a data/org_registry.json organization entry. */
interface RegistryOrg {
  id: number
  name: string
  uuid: string
  /** Repo-relative path of the org's isochrone file, null when none. */
  branches_isochrone: string | null
  /** True when the isochrone file matches the org's current branch set. */
  isIsochroneUpdated: boolean
}

const orgRegistry = orgRegistryFile as { organizations: RegistryOrg[] }

export interface OrgIsochroneSelection {
  /** Org name the dataset was resolved for — for run archives/audit logs. */
  orgName: string
  /** Repo-relative path, passed to loadIsochrones. */
  file: string
}

/**
 * Isochrone dataset for the selected org(s), or null when any selected org
 * has none — containment must never leak into a mixed selection. Entries are
 * the org uuid (what the front-end sends); numeric ids also work. Same key
 * rules as branchesForOrgs.
 *
 * To onboard a new org: generate its file with scripts/generate-isochrones.mjs,
 * drop it in data/, then set branches_isochrone + isIsochroneUpdated in
 * data/org_registry.json.
 */
export function isochronesForOrgs(orgIds: unknown): OrgIsochroneSelection | null {
  if (!Array.isArray(orgIds) || orgIds.length === 0) return null
  let selection: OrgIsochroneSelection | null = null
  for (const raw of orgIds) {
    const key = String(raw).trim().toLowerCase()
    const numericId = Number(raw)
    const org = orgRegistry.organizations.find(
      (entry) =>
        entry.uuid === key ||
        (Number.isFinite(numericId) && entry.id === numericId)
    )
    if (!org?.branches_isochrone || org.isIsochroneUpdated !== true) return null
    selection = { orgName: org.name, file: org.branches_isochrone }
  }
  return selection
}
