// Org ↔ isochrone dataset registry. Reads data/org_registry.json at runtime
// (never bundled) so changes take effect without a rebuild.
//
// Flow per org:
//   branches == null          → throw (no branch data configured)
//   isIsochroneUpdated false  → run scripts/generate-isochrones.mjs, update registry
//   isIsochroneUpdated true   → use branches_isochrone directly

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const REGISTRY_PATH = path.join(process.cwd(), "data/org_registry.json")

interface RegistryOrg {
  id: number
  name: string
  uuid: string
  /** Repo-relative path of the org's branch JSON, null when none. */
  branches: string | null
  /** Repo-relative path of the generated isochrone file, null when not yet generated. */
  branches_isochrone: string | null
  /** True when branches_isochrone is up-to-date with the current branch set. */
  isIsochroneUpdated: boolean
}

function readRegistry(): { organizations: RegistryOrg[] } {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"))
}

function writeRegistry(registry: { organizations: RegistryOrg[] }): void {
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2))
}

function findOrg(registry: { organizations: RegistryOrg[] }, raw: unknown): RegistryOrg | undefined {
  const key = String(raw).trim().toLowerCase()
  const numericId = Number(raw)
  return registry.organizations.find(
    (entry) =>
      entry.uuid === key ||
      (Number.isFinite(numericId) && entry.id === numericId)
  )
}

/**
 * Generates the isochrone file for an org by running scripts/generate-isochrones.mjs,
 * then marks isIsochroneUpdated = true in the registry.
 */
function generateAndUpdateRegistry(org: RegistryOrg): string {
  const branchesPath = path.join(process.cwd(), org.branches!)
  const stem = path.basename(org.branches!).replace(/\.json$/i, "")
  const outFile = `data/${stem}_isochrones.geojson`
  const outPath = path.join(process.cwd(), outFile)
  const scriptPath = path.join(process.cwd(), "scripts/generate-isochrones.mjs")

  try {
    execFileSync(process.execPath, [scriptPath, branchesPath, "--out", outPath], {
      stdio: "inherit",
      timeout: 600_000,
    })
  } catch (err) {
    throw new Error(
      `Isochrone generation failed for "${org.name}": ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const registry = readRegistry()
  const entry = findOrg(registry, org.uuid)
  if (entry) {
    entry.branches_isochrone = outFile
    entry.isIsochroneUpdated = true
    writeRegistry(registry)
  }

  return outFile
}

export interface OrgIsochroneSelection {
  orgName: string
  file: string
}

/**
 * Resolves the isochrone file for the given org(s). Throws when branch data
 * is missing or generation fails. Generates fresh isochrones when stale.
 *
 * Entries are the org uuid (what the front-end sends); numeric ids also work.
 */
export async function isochronesForOrgs(orgIds: unknown): Promise<OrgIsochroneSelection | null> {
  if (!Array.isArray(orgIds) || orgIds.length === 0) return null

  let selection: OrgIsochroneSelection | null = null

  for (const raw of orgIds) {
    const registry = readRegistry()
    const org = findOrg(registry, raw)

    if (!org) return null

    if (!org.branches) {
      throw new Error(`No branch data configured for organization "${org.name}"`)
    }

    let isochroneFile: string

    if (!org.isIsochroneUpdated || !org.branches_isochrone) {
      isochroneFile = generateAndUpdateRegistry(org)
    } else {
      isochroneFile = org.branches_isochrone
    }

    selection = { orgName: org.name, file: isochroneFile }
  }

  return selection
}
