import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { HtmlBuilder } from './html-builder'
import { buildSplash, SINGLE_FILE_SPLASH_HOOK_JS } from './splash'
import type { SplashOptions } from './splash'
import type { PackageConfig } from '../types'

export type InputKind = 'loader' | 'single-file'

/**
 * Which packaging path a build takes. A single-file build references no local
 * file — everything is inlined — so that is the whole test. Anything else
 * (Cocos web-mobile, a plain multi-file HTML build) goes through the runtime
 * loader as before. An explicit choice wins, except that 'single-file' on a
 * build with local refs is a lie the packager refuses to act on.
 */
export function detectInputKind(
  builder: HtmlBuilder,
  explicit?: PackageConfig['input'],
): InputKind {
  const refs = builder.getLocalRefs()
  if (explicit === 'single-file' && refs.length) {
    throw new Error(
      `not a single-file build: index.html references local file(s) ${refs.join(', ')} — ` +
        `inline them (Vite: vite-plugin-singlefile) or drop config.input`,
    )
  }
  if (explicit && explicit !== 'auto') return explicit
  return refs.length ? 'loader' : 'single-file'
}

/**
 * Files inside `buildDir`, besides `index.html`, that `getLocalRefs` never
 * found — a sanity check on top of the reference scan for `detectInputKind`.
 * `getLocalRefs` reads what the HTML claims to need; this reads what the
 * build directory actually contains. When the two disagree with files left
 * over, either the build is truly single-file and those files are junk, OR
 * the game fetches them at runtime by a path the HTML markup never mentions
 * (a common free-stack pattern: assets loaded via `fetch()`/`new Audio()`
 * with a computed URL) — in which case auto-detecting single-file would ship
 * an artifact missing those files. The packager can't tell which case it is,
 * so it only warns (see `packageForNetworks`), never blocks.
 *
 * Recursive, relative paths, dotfiles (`.plbx.json` and friends) excluded —
 * those are tooling metadata, never build output a game would fetch.
 */
export function unreferencedBuildFiles(buildDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const full = join(dir, name)
      let isDir: boolean
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        walk(full)
        continue
      }
      const rel = relative(buildDir, full)
      if (rel === 'index.html') continue
      out.push(rel)
    }
  }
  walk(buildDir)
  return out
}

/**
 * Turn an adapter-transformed single-file HTML into the shippable artifact:
 * splash overlay (hidden on game_ready), then the classic-bundle rewrite that
 * puts the game after every bridge script. Runs AFTER adapter.transform and
 * the packager's own head injections, so the bundle ends up last.
 */
export function applySingleFileRewrite(
  builder: HtmlBuilder,
  splash: SplashOptions | null,
): void {
  if (splash) {
    const s = buildSplash(splash)
    builder.injectHeadStyle(s.styleCss)
    builder.prependBody(s.bodyHtml)
    builder.injectBodyScript(s.hideJs + SINGLE_FILE_SPLASH_HOOK_JS)
  }
  builder.toClassicBundle()
}
