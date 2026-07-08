import { getNetwork, maxSizeForFormat } from '../networks'
import { generatePreviewUtil } from './sdk-mocks'

/** Adversarial MRAID timing modes (spec §6). Baked per rendition — the mock
 *  compiles the mode into its generated source, so switching means loading a
 *  different rendition, not a postMessage toggle. */
export type PreviewMode = 'happy' | 'neverViewable' | 'lostPulse'

export const PREVIEW_MODES: readonly PreviewMode[] = [
  'happy',
  'neverViewable',
  'lostPulse',
]

export interface PreviewRenditionInput {
  /** Packaged artifact HTML (single-file; for zip networks the inner HTML). */
  html: string
  networkId: string
  mode: PreviewMode
}

/** Mirrors the extension preview server's injectPreviewUtil: the mock script
 *  must run before any game code, so it lands right after <head>. */
function injectScript(html: string, script: string): string {
  const headIdx = html.indexOf('<head>')
  if (headIdx === -1) {
    const headMatch = html.match(/<head[^>]*>/)
    if (headMatch && headMatch.index !== undefined) {
      const insertAt = headMatch.index + headMatch[0].length
      return (
        html.slice(0, insertAt) +
        '<script>' +
        script +
        '</script>' +
        html.slice(insertAt)
      )
    }
    return '<script>' + script + '</script>' + html
  }
  const insertAt = headIdx + '<head>'.length
  return (
    html.slice(0, insertAt) +
    '<script>' +
    script +
    '</script>' +
    html.slice(insertAt)
  )
}

/**
 * Self-contained browser preview of a packaged artifact: SDK mocks
 * (mraid/FbPlayableAd/ExitApi/playableSDK/MTRG…) + the postMessage event
 * bridge (`{ type: 'plbx:preview', event, data }` to the parent frame; CTA
 * events tagged with `expected`/`correct`) injected into the artifact HTML.
 * Generated once per mode at packaging time and served off-origin (spec §6).
 */
export function buildPreviewRendition(input: PreviewRenditionInput): string {
  const network = getNetwork(input.networkId)
  if (!network) throw new Error(`Unknown network id: ${input.networkId}`)

  const util = generatePreviewUtil({
    networkId: network.id,
    mraid: network.mraid,
    maxSize: maxSizeForFormat(network, network.format),
    mraidMode: input.mode,
  })
  return injectScript(input.html, util)
}
