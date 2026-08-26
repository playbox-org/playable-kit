import { HtmlBuilder } from '../html-builder'
import { NetworkConfig, PackageConfig } from '../../types'
import { ArtifactVariant, BaseAdapter, googleBridge } from './base'

/** `content` of the both-orientations meta the primary archive carries. Google
 *  documents this exact spelling for "fully responsive assets working in both
 *  orientations" — the reason one archive is already enough for App campaigns. */
const BOTH_ORIENTATIONS = 'portrait,landscape'

/**
 * Declared slot size per fixed-orientation archive. These two are the ONLY
 * dimensions Google accepts ("There are only 2 supported asset dimensions:
 * 320x480 (portrait) 480x320 (landscape)") — never the creative's real canvas
 * resolution. Purely trafficking metadata: the spec requires the asset to be
 * responsive precisely because it renders across "a range of full-screen
 * display sizes", so declaring 320x480 does not scale a full-bleed canvas down.
 * Note the `width=,height=` form — `480x320` is not a format Google parses.
 * https://support.google.com/google-ads/answer/12771973
 */
const AD_SIZE: Record<'portrait' | 'landscape', string> = {
  portrait: 'width=320,height=480',
  landscape: 'width=480,height=320',
}

/** Matches the `ad.orientation` meta the primary archive carries, whatever
 *  attribute order/quoting cheerio serialised it with. */
const AD_ORIENTATION_META = /<meta\s+name="ad\.orientation"[^>]*>/i

/**
 * Google Ads adapter.
 * - Injects ExitAPI script (via sdkUrl in NetworkConfig)
 * - Injects `<meta name="ad.orientation" content="portrait,landscape">`
 * - Emits three archives (see getArtifactVariants): the both-orientations one
 *   plus a fixed `ad.size` archive per orientation.
 */
export class GoogleAdapter extends BaseAdapter {
  constructor(networkId: string, networkConfig: NetworkConfig) {
    super(networkId, networkConfig)
  }

  protected getPlbxBridge(_config: PackageConfig): string {
    return googleBridge()
  }

  transform(builder: HtmlBuilder, config: PackageConfig): void {
    super.transform(builder, config)

    // The creative itself is responsive — it declares both orientations and the
    // per-orientation archives are produced by swapping this one tag, so the
    // packaged payload never depends on config.orientation here.
    builder.injectMeta('ad.orientation', BOTH_ORIENTATIONS)

    // Inject clickTag variable required by Google Ads Rich Media validator.
    // Must be a `var` declaration (validator pattern-matches for it).
    // Default value is Google's macro; falls back to URL param at runtime.
    const clickTagScript =
      `var clickTag = "%%CLICK_URL_UNESC%%";\n` +
      `try { var u = new URLSearchParams(window.location.search).get("clickTag"); if (u) clickTag = u; } catch(e) {}`
    builder.injectBodyScript(clickTagScript)
  }

  /**
   * Three archives from one payload. `<name>.zip` declares both orientations
   * and is on its own enough for Google — the extras exist for buyers whose
   * slot is orientation-locked, not because the spec demands one file per
   * orientation. `<name>_portrait.zip` / `<name>_landscape.zip` pin the
   * orientation and carry BOTH tags: `ad.orientation` is what App campaigns
   * actually read ("If both meta tags are declared in HTML, the
   * 'ad.orientation' value will be used"), while `ad.size` keeps the archive
   * legible to the older size-only surfaces — super-html ships the size tag
   * alone, which leaves its fixed archives on that legacy path.
   */
  getArtifactVariants(_config: PackageConfig): ArtifactVariant[] {
    return [
      { suffix: '', transformHtml: (html) => html },
      ...(['portrait', 'landscape'] as const).map((o) => ({
        suffix: `_${o}`,
        label: o,
        transformHtml: (html: string) =>
          html.replace(
            AD_ORIENTATION_META,
            `<meta name="ad.orientation" content="${o}">` +
              `<meta name="ad.size" content="${AD_SIZE[o]}">`,
          ),
      })),
    ]
  }
}
