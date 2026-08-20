import { NetworkConfig, PackageConfig } from '../../types'
import { BaseAdapter, lunaBridge } from './base'

/** luna.json `default.orientation` — Luna's own vocabulary, not ours. */
const ORIENTATION_MAP: Record<string, string> = {
  auto: 'unspecified',
  portrait: 'portrait',
  landscape: 'landscape',
}

/** luna.json `tiktok.orientation` — the same numeric map the TikTok adapter uses. */
const TIKTOK_ORIENTATION_MAP: Record<string, number> = {
  auto: 0,
  portrait: 1,
  landscape: 2,
}

/**
 * Luna (Unity Playworks) adapter.
 *
 * Luna is an export platform, not a delivery network: it takes one archive from
 * us and re-exports it per ad network, injecting that network's SDK itself. So
 * this adapter deliberately ships NO network wrapper (`mraid: false` in the
 * registry already turns `mraid.js` into a forbidden string) and only wires
 * Luna's own runtime contract — see lunaBridge for the boot gate, the
 * InstallFullGame CTA, GameEnded, the `luna:*` lifecycle and the
 * plbx_html.log_event analytics channel.
 *
 * The upload archive is exactly three root files: `source.html` (the name comes
 * from NetworkConfig.htmlFileName) plus the two manifests emitted below.
 */
export class LunaAdapter extends BaseAdapter {
  constructor(networkId: string, networkConfig: NetworkConfig) {
    super(networkId, networkConfig)
  }

  protected getPlbxBridge(_config: PackageConfig): string {
    return lunaBridge()
  }

  getZipExtraFiles(
    config: PackageConfig,
  ): Array<{ zipPath: string; content: string }> {
    // Two different values on purpose. `applicationName` is the app IDENTITY
    // Luna publishes into the client's Playworks account — spec §2 maps it to
    // `assetTitle || projectName || ''` and an EMPTY string is Luna's own
    // documented "unknown" (the reference archive ships it empty). Defaulting
    // it to 'Playable' here re-invented the fabricated name the packager had
    // just stopped inventing. Only playground.json's `title` is a human-facing
    // display label, so that is the one place a placeholder is harmless.
    const applicationName = config.appName || ''
    const playgroundTitle = applicationName || 'Playable'
    // Skeleton taken verbatim from Luna's own reference archive: the keys we do
    // not populate stay present with their empty defaults, because Luna's
    // exporter reads them and a missing key is not the same as an empty one.
    const luna = {
      unity: {
        packages: {
          default: {
            applicationName,
            iosLink: config.storeUrlIos || '',
            androidLink: config.storeUrlAndroid || '',
            orientation: ORIENTATION_MAP[config.orientation] || 'unspecified',
            supportedLanguages: ['en'],
          },
          ironsource: {
            appID: '',
            assetID: '',
            applicationGenre: '',
            versionName: '',
            apiType: 0,
            playableMode: 0,
            packageType: 0,
          },
          facebook: { assetID: '', packageType: 0 },
          tiktok: {
            orientation: TIKTOK_ORIENTATION_MAP[config.orientation] ?? 0,
          },
        },
      },
    }
    // `fields` stays empty by design — Playground fields are a per-project
    // authoring feature, not something a packager can invent. `icon` is a
    // data-URI PNG in Luna's examples; null is accepted and is what we emit.
    const playground = { title: playgroundTitle, icon: null, fields: {} }
    return [
      { zipPath: 'luna.json', content: JSON.stringify(luna, null, 2) },
      { zipPath: 'playground.json', content: JSON.stringify(playground, null, 2) },
    ]
  }
}
