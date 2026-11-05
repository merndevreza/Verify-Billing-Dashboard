// Org ↔ branch dataset registry. Reads data/org_registry.json at runtime
// so changes take effect without a rebuild.

import { readFileSync } from "node:fs"
import path from "node:path"
import type { Branch } from "./branches"

const REGISTRY_PATH = path.join(process.cwd(), "data/org_registry.json")

interface RegistryOrg {
  id: number
  name: string
  uuid: string
  branches: string | null
}

function readRegistry(): { organizations: RegistryOrg[] } {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"))
}

export interface OrgBranchSelection {
  orgName: string
  branches: Branch[]
}

/**
 * Branch dataset for the selected org(s), or null when any selected org has
 * no branch file configured. Entries are the org uuid or numeric id.
 */
export function branchesForOrgs(orgIds: unknown): OrgBranchSelection | null {
  if (!Array.isArray(orgIds) || orgIds.length === 0) return null
  let selection: OrgBranchSelection | null = null
  for (const raw of orgIds) {
    const key = String(raw).trim().toLowerCase()
    const numericId = Number(raw)
    const registry = readRegistry()
    const org = registry.organizations.find(
      (entry) =>
        entry.uuid === key ||
        (Number.isFinite(numericId) && entry.id === numericId)
    )
    if (!org?.branches) return null
    const file = JSON.parse(
      readFileSync(path.join(process.cwd(), org.branches), "utf8")
    ) as { branches: Branch[] }
    selection = { orgName: org.name, branches: file.branches }
  }
  return selection
}
