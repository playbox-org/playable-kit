import { getNetwork } from '../networks'

export interface ZipRootFilesVerdict {
  /** The network's declared root files (`NetworkConfig.zipRootFiles`). */
  required: string[]
  /** Required files not found at the archive root. */
  missing: string[]
  /** Subset of `missing` that exists deeper in the archive (wrapping folder). */
  misplaced: string[]
  /** Subset of `missing` that is not in the archive at all. */
  absent: string[]
  /** Human remediation, null when everything is in place. */
  details: string | null
}

/**
 * Root-file contract of a ZIP network — ONE implementation for the kit's
 * `validateArtifact`, the extension's preview panel and the platform's web
 * validator, so a rule declared in `NetworkConfig.zipRootFiles` (Tencent's
 * `config.json`, Luna's manifests) cannot be green in one and red in another.
 *
 * Returns null for networks that declare nothing. `entries` are archive
 * paths; directory entries and backslashes are tolerated. A file sitting in a
 * folder and a file that is not in the archive at all get opposite advice —
 * "move it to the root" is useless for one that was never written.
 */
export function zipRootFilesVerdict(
  networkId: string,
  entries: string[],
): ZipRootFilesVerdict | null {
  const net = getNetwork(networkId)
  const required = net?.zipRootFiles
  if (!net || !required || required.length === 0) return null

  const names = entries
    .map((e) => e.replace(/\\/g, '/'))
    .filter((e) => e && !e.endsWith('/'))
  const atRoot = new Set(names.filter((e) => !e.includes('/')))
  const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
  const pathOf = (f: string) => names.find((e) => baseName(e) === f)

  const missing = required.filter((f) => !atRoot.has(f))
  const misplaced = missing.filter((f) => !!pathOf(f))
  const absent = missing.filter((f) => !pathOf(f))

  const parts: string[] = []
  if (misplaced.length) {
    const first = pathOf(misplaced[0]) as string
    const folder = first.slice(0, first.lastIndexOf('/'))
    parts.push(
      `${misplaced.join(' and ')} sit inside ${folder}/ instead of the archive root — zip the build folder's contents, not the folder itself`,
    )
  }
  if (absent.length) {
    parts.push(
      `Missing ${absent.join(' and ')} — ${net.name} expects ${required.join(' and ')} at the archive root`,
    )
  }
  return {
    required,
    missing,
    misplaced,
    absent,
    details: parts.length ? parts.join('. ') : null,
  }
}
