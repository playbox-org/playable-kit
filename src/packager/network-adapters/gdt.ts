import { NetworkConfig, PackageConfig } from '../../types'
import { BaseAdapter, buildPlbxBridge } from './base'

/** 优量汇 `config.json` → `config.play_direction`: 0 = both, 1 = portrait, 2 = landscape. */
const PLAY_DIRECTION: Record<string, number> = {
  auto: 0,
  portrait: 1,
  landscape: 2,
}

/**
 * Tencent Ads / 优量汇 (Youlianghui, ex-广点通 GDT) bridge — docs/networks/tencent-gdt-playable.md §4.
 *
 * The creative instantiates `window.GDTUnSdk` once (`type: 'playable'` is the
 * only accepted value — anything else is SDK error 1002) and reports the CTA
 * with `_gdtUnSdk.playAble.onClick()` (capital A). The SDK performs the store
 * jump itself; a `window.open()` of our own would be both untracked and the
 * "JavaScript redirect" the spec forbids, so it stays a dev-only fallback for
 * when the SDK never loaded (preview server, file://). No lifecycle exists:
 * nothing in the container calls the creative, and the creative signals
 * nothing but the click.
 *
 * Instantiation is eager (spec order: SDK in <head>, instance at load) AND
 * retried lazily on the first CTA, because the CDN script can arrive late or
 * be replaced by the preview's mock after our body script already ran.
 */
export function gdtBridge(): string {
  return buildPlbxBridge(
    `var s = _plbxGdt(); if (s && s.playAble && s.playAble.onClick) { s.playAble.onClick(); } else if (url) { window.open(url, "_blank"); }`,
    `function _plbxGdt() {
  if (!window._gdtUnSdk && window.GDTUnSdk) {
    try {
      window._gdtUnSdk = new window.GDTUnSdk({
        type: 'playable',
        onSuccess: function(res) { console.log('[plbx] gdt click reported', res); },
        onError: function(res) { console.error('[plbx] gdt sdk error', res); }
      });
    } catch(e) { console.error('[plbx] gdt sdk init', e); }
  }
  return window._gdtUnSdk || null;
}
_plbxGdt();
// Game CTA dispatchers that bypass plbx_html.download() and call window.install()
// or window.open(link) directly must still reach the SDK — same shape as the
// Facebook/Snapchat bridges. The tracked click is the only conversion signal.
window.install = function() { var s = _plbxGdt(); if (s && s.playAble && s.playAble.onClick) s.playAble.onClick(); };
var _plbxOrigOpen = window.open;
window.open = function(u) {
  var s = _plbxGdt();
  if (s && s.playAble && s.playAble.onClick) { try { s.playAble.onClick(); } catch(e) {} return null; }
  try { return _plbxOrigOpen.apply(window, arguments); } catch(e) { return null; }
};`,
  )
}

/**
 * Tencent Ads / 优量汇 adapter.
 * - SDK `<script>` comes from `sdkUrl` via BaseAdapter (https, no `crossorigin`)
 * - CTA → `_gdtUnSdk.playAble.onClick()` (gdtBridge)
 * - ZIP gets the mandatory root `config.json` with `play_direction`
 * - forbidden `document.write` / `crossorigin` / `mraid.js` come from the registry
 */
export class GdtAdapter extends BaseAdapter {
  constructor(networkId: string, networkConfig: NetworkConfig) {
    super(networkId, networkConfig)
  }

  protected getPlbxBridge(_config: PackageConfig): string {
    return gdtBridge()
  }

  getZipConfig(config: PackageConfig): Record<string, any> | null {
    return {
      name: config.appName || 'playable',
      version: '0.0.1',
      config: {
        play_direction: PLAY_DIRECTION[config.orientation] ?? 0,
      },
    }
  }
}
