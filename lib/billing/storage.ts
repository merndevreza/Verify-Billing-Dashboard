import { randomBytes } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * Local-only storage: every calculation gets its own folder under
 * <project>/.data/billing/<runId>/ (gitignored) holding the original
 * download plus the processed JSON. Swap this module for a DB later.
 */
const ROOT = path.join(process.cwd(), ".data", "billing")

export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `${stamp}_${randomBytes(3).toString("hex")}`
}

export async function saveRunFile(
  runId: string,
  fileName: string,
  data: Buffer | string
): Promise<string> {
  const dir = path.join(ROOT, runId)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, path.basename(fileName))
  await writeFile(filePath, data)
  return path.relative(process.cwd(), filePath)
}