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
