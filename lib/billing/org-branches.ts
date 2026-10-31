// Org ↔ branch dataset registry. Maps every org in data/org_data.json to its
// bundled branch file (matched by uuid); orgs whose branch data isn't
// available yet get branches: null and never go through branch-based checks.

import orgData from "@/data/org_data.json"
import bracBranchFile from "@/data/brac_branches.json"
import type { Branch } from "./branches"

/** Shape of a bundled data/*_branches.json file. */
interface BranchFile {
  org_name: string
  org_uuid: string
  branches: Branch[]
}

/**
 * All bundled branch files. Add a new org's branch data by dropping a JSON
 * with the same shape into data/ and listing it here.
 */
const BRANCH_FILES: BranchFile[] = [
  { ...bracBranchFile, branches: bracBranchFile.branches as Branch[] },
]

export interface OrgBranches {
  id: number
  name: string
  uuid: string
  /** Branch dataset for this org — null when none is bundled. */
  branches: Branch[] | null
}

/** Every org from org_data.json mapped to its branch dataset (null if none). */
export const ORG_BRANCHES: OrgBranches[] = orgData.organizations.map((org) => {
  const file = BRANCH_FILES.find((f) => f.org_uuid === org.uuid)
  return {
    id: org.id,
    name: org.name,
    uuid: org.uuid,
    branches: file ? file.branches : null,
  }
})

/** A resolved branch selection: the dataset plus the org it belongs to. */
export interface OrgBranchSelection {
  /** Org name the dataset was resolved for — for run archives/audit logs. */
  orgName: string
  branches: Branch[]
}

/**
 * Branch dataset for the selected org(s), or null when any selected org has
 * no bundled dataset — branch checks must never leak into a mixed selection.
 * Entries are the org uuid (what the front-end sends); numeric ids also work.
 */
export function branchesForOrgs(
  orgIds: unknown
): OrgBranchSelection | null {
  if (!Array.isArray(orgIds) || orgIds.length === 0) return null
  let selection: OrgBranchSelection | null = null
  for (const raw of orgIds) {
    const key = String(raw).trim().toLowerCase()
    const numericId = Number(raw)
    const entry = ORG_BRANCHES.find(
      (org) =>
        org.uuid === key ||
        (Number.isFinite(numericId) && org.id === numericId)
    )
    if (!entry?.branches) return null
    selection = { orgName: entry.name, branches: entry.branches }
  }
  return selection
}
