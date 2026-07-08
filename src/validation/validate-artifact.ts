import { getAdapter } from '../packager/network-adapters'
import { validateLauncher } from '../packager/launcher-builder'
import { getNetwork } from '../networks'
import type { ArtifactFileKind, CheckResult } from '../types'
import { extractAxonUsage, validateAxonEvents } from './axon-events'
import {
  parseHostileMp3Marker,
  parseRiskyAudioMarker,
} from './audio-format-check'
import { scanLoaderHealth } from './loader-health'
import { detectRegionalParams, extractStoreUrls } from './store-url-extractor'

/** Substring identifying a usable Google Play Store URL (mirrors the packager). */
const GOOGLE_PLAY_MARKER = 'play.google.com/store/apps/details'

export interface ArtifactFileCheckInput {
  kind: ArtifactFileKind
  sizeBytes: number
  /** Size ceiling for this file kind; null/undefined = no limit enforced. */
  maxSizeBytes?: number | null
}

export interface ValidateArtifactInput {
  networkId: string
  /** Primary artifact HTML content (for zip networks: the inner HTML). */
  html?: string | null
  /** launcher.html content — launcher-payload networks only. */
  launcherHtml?: string | null
  files: ArtifactFileCheckInput[]
  /**
   * Source dist directory, when available (packaging time). Enables
   * source-scan checks (Axon event literals, store-URL regional params) that
   * cannot run against the packed artifact alone; revalidation over S3
   * artifacts omits it and those checks are skipped.
   */
  buildDir?: string
}

function formatBytes(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * Static validation of one packaged network artifact → flat CheckResult[]
 * (spec §3 "validation" module). Composes the per-network static checks the
 * Cocos extension runs in its Validate window: size limits per file kind,
 * forbidden/required strings, loader health, launcher checks, audio markers,
 * store-URL presence, Axon events.
 */
export function validateArtifact(input: ValidateArtifactInput): CheckResult[] {
  const network = getNetwork(input.networkId)
  if (!network) {
    return [
      {
        id: 'network-known',
        label: 'Network is registered',
        status: 'failed',
        details: `Unknown network id: ${input.networkId}`,
      },
    ]
  }

  const checks: CheckResult[] = []
  const html = input.html ?? null

  for (const file of input.files) {
    const limit = file.maxSizeBytes ?? null
    const over = limit !== null && file.sizeBytes > limit
    checks.push({
      id: `size-${file.kind}`,
      label: `${file.kind} size within limit`,
      status: over ? 'failed' : 'passed',
      details:
        limit === null
          ? `${formatBytes(file.sizeBytes)} (no limit)`
          : `${formatBytes(file.sizeBytes)} of ${formatBytes(limit)}`,
    })
  }

  if (html !== null) {
    const adapter = getAdapter(input.networkId)

    const forbidden = adapter
      .getForbiddenStrings()
      .filter((s) => html.includes(s))
    checks.push({
      id: 'forbidden-strings',
      label: 'No forbidden strings',
      status: forbidden.length ? 'failed' : 'passed',
      details: forbidden.length ? `Found: ${forbidden.join(', ')}` : null,
    })

    const missing = adapter
      .getRequiredStrings()
      .filter((s) => !html.includes(s))
    checks.push({
      id: 'required-strings',
      label: 'Required strings present',
      status: missing.length ? 'failed' : 'passed',
      details: missing.length ? `Missing: ${missing.join(', ')}` : null,
    })

    for (const loaderCheck of scanLoaderHealth(html, {
      mraid: network.mraid,
    })) {
      checks.push({
        id: `loader-${loaderCheck.id}`,
        label: `Loader health: ${loaderCheck.id.replace(/_/g, ' ')}`,
        status: loaderCheck.pass ? 'passed' : 'failed',
        details: loaderCheck.pass ? null : loaderCheck.detail,
      })
    }

    const riskyAudio = parseRiskyAudioMarker(html)
    if (riskyAudio.length) {
      checks.push({
        id: 'risky-audio',
        label: 'No iOS-risky audio (ogg/opus/webm)',
        status: 'warning',
        details: `Safari/iOS may fail to decode: ${riskyAudio.join(', ')}`,
      })
    }

    const hostileMp3 = parseHostileMp3Marker(html)
    if (hostileMp3.length) {
      checks.push({
        id: 'hostile-mp3',
        label: 'No WebKit-hostile MP3 (ultra-short VBR/Xing)',
        status: 'warning',
        details: `Heuristic flagged: ${hostileMp3.join(', ')}`,
      })
    }

    if (network.requiresStoreUrl) {
      const hasStoreUrl = html.includes(GOOGLE_PLAY_MARKER)
      checks.push({
        id: 'store-url',
        label: 'Google Play store URL present',
        status: hasStoreUrl ? 'passed' : 'warning',
        details: hasStoreUrl
          ? null
          : 'The network validator greps for a play.google.com/store/apps/details URL',
      })
    }
  }

  if (network.format === 'launcher-payload' && input.launcherHtml) {
    for (const launcherCheck of validateLauncher(input.launcherHtml)) {
      checks.push({
        id: `launcher-${launcherCheck.id}`,
        label: launcherCheck.label,
        status: launcherCheck.ok ? 'passed' : 'failed',
        details: launcherCheck.ok ? null : (launcherCheck.detail ?? null),
      })
    }
  }

  if (input.buildDir) {
    if (input.networkId === 'applovin') {
      const usage = extractAxonUsage(input.buildDir)
      for (const axonCheck of validateAxonEvents(usage)) {
        checks.push({
          id: `axon-${axonCheck.id}`,
          label: axonCheck.label,
          status: axonCheck.ok
            ? 'passed'
            : axonCheck.level === 'error'
              ? 'failed'
              : 'warning',
          details: axonCheck.ok ? null : (axonCheck.detail ?? null),
        })
      }
    }

    const regional = extractStoreUrls(input.buildDir).flatMap((url) =>
      detectRegionalParams(url),
    )
    if (regional.length) {
      checks.push({
        id: 'store-url-regional',
        label: 'No regional store-URL params',
        status: 'warning',
        details: `Remove regional params so the creative serves globally: ${[...new Set(regional)].join(', ')}`,
      })
    }
  }

  return checks
}

/** Aggregate CheckResult[] → the artifact's checksStatus. */
export function summarizeChecks(
  checks: CheckResult[],
): 'passed' | 'warning' | 'failed' {
  if (checks.some((c) => c.status === 'failed')) return 'failed'
  if (checks.some((c) => c.status === 'warning')) return 'warning'
  return 'passed'
}
