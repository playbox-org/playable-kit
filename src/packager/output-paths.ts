import { existsSync, readdirSync, realpathSync } from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { getNetwork } from '../networks'
import type { OutputFormat } from '../types'
import type { PackagerOptions } from './types'
import { resolveTemplate } from './template-resolver'

export function resolveOutputPath(options: PackagerOptions, networkId: string, format: OutputFormat): string {
  return join(options.outputDir, resolveTemplate(options.outputTemplate || '{networkId}/index.{ext}', {
    network: networkId,
    networkId,
    format,
    ext: format,
    ...options.templateVariables,
  }))
}

function canonicalPath(path: string): string {
  const absolute = resolve(path)
  return existsSync(absolute) ? realpathSync(absolute)
    : join(canonicalPath(dirname(absolute)), basename(absolute))
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

function hasFiles(path: string): boolean {
  return existsSync(path) && readdirSync(path, { withFileTypes: true }).some(entry =>
    !entry.isDirectory() || hasFiles(join(path, entry.name)),
  )
}

export function assertSafeOutputPaths(options: PackagerOptions): void {
  const build = canonicalPath(options.buildDir)
  for (const id of options.networks) {
    const network = getNetwork(id)
    if (!network) continue
    const formats: OutputFormat[] = [network.format]
    if (network.dualFormat) formats.push(network.format === 'html' ? 'zip' : 'html')
    for (const format of formats) {
      const parent = canonicalPath(format === 'launcher-payload'
        ? join(options.outputDir, id) : dirname(resolveOutputPath(options, network.id, format)))
      // All renamed archives, variants, secondary files and staging stay in this parent.
      // Conservatively reserve it rather than guessing which existing files are prior outputs.
      const aliasesInput = existsSync(parent) && readdirSync(parent, { withFileTypes: true }).some(entry => {
        if (!entry.isSymbolicLink()) return false
        const target = canonicalPath(join(parent, entry.name))
        return contains(build, target) || contains(target, build)
      })
      if (contains(parent, build) || (contains(build, parent) && hasFiles(parent)) || aliasesInput) {
        throw new Error(`Output directory ${parent} overlaps the input build ${build}; use an empty/new nested output directory or one outside the build.`)
      }
    }
  }
}
