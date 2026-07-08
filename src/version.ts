declare const __KIT_VERSION__: string | undefined

/**
 * Kit version, injected at build time by tsup `define`.
 * Falls back to a dev marker when running from source (vitest, ts-node).
 */
export const KIT_VERSION: string =
  typeof __KIT_VERSION__ !== 'undefined' ? __KIT_VERSION__ : '0.0.0-dev'
