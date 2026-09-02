import { NetworkConfig, OutputFormat } from './types'

const MB5 = 5 * 1024 * 1024 // 5242880 bytes
const MB3 = 3 * 1024 * 1024 // 3145728 bytes
const MB2 = 2 * 1024 * 1024 // 2097152 bytes

export const NETWORKS: Record<string, NetworkConfig> = {
  preview: {
    id: 'preview',
    name: 'Preview',
    format: 'html',
    maxSize: 10 * 1024 * 1024, // 10MB — no real limit for preview
    mraid: false,
    inlineAssets: true,
  },
  applovin: {
    id: 'applovin',
    name: 'AppLovin',
    format: 'html',
    maxSize: MB5,
    mraid: true,
    inlineAssets: true,
  },
  unity: {
    id: 'unity',
    name: 'Unity Ads',
    format: 'html',
    maxSize: MB5,
    mraid: true,
    inlineAssets: true,
    requiresStoreUrl: true,
  },
  ironsource: {
    id: 'ironsource',
    name: 'ironSource',
    format: 'html',
    maxSize: MB5,
    mraid: true,
    inlineAssets: true,
  },
  adcolony: {
    id: 'adcolony',
    name: 'AdColony',
    format: 'html',
    // No official DT Exchange / AdColony playable file-size limit is published;
    // 5 MB is an internal cap (was MB2 — that figure had no source). Verified 2026-07-01.
    maxSize: MB5,
    mraid: true,
    inlineAssets: true,
  },
  tapjoy: {
    id: 'tapjoy',
    name: 'Tapjoy',
    format: 'html',
    maxSize: 1.9 * 1024 * 1024, // 1.9 MB
    mraid: false,
    inlineAssets: true,
  },
  appreciate: {
    id: 'appreciate',
    name: 'Appreciate',
    format: 'html',
    maxSize: MB5,
    mraid: true,
    inlineAssets: true,
  },
  chartboost: {
    id: 'chartboost',
    name: 'Chartboost',
    format: 'html',
    maxSize: MB3,
    mraid: true,
    inlineAssets: true,
  },
  liftoff: {
    id: 'liftoff',
    name: 'Liftoff',
    format: 'html',
    maxSize: MB5,
    mraid: true,
    inlineAssets: true,
    dualFormat: true,
  },
  smadex: {
    id: 'smadex',
    name: 'Smadex',
    format: 'html',
    maxSize: MB5,
    mraid: false,
    inlineAssets: true,
  },
  rubeex: {
    id: 'rubeex',
    name: 'Rubeex',
    format: 'html',
    maxSize: MB5,
    mraid: false,
    inlineAssets: true,
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook/Meta',
    format: 'html',
    // 5 MB for both the single HTML and the ZIP total (<=100 files). The old
    // 2 MB single-HTML figure is obsolete — Meta raised it; kept as one ceiling
    // so no htmlMaxSize override is needed. Updated 2026-08-20.
    maxSize: MB5,
    mraid: false,
    inlineAssets: true,
    dualFormat: true,
  },
  moloco: {
    id: 'moloco',
    name: 'Moloco',
    format: 'html',
    maxSize: MB5,
    mraid: false,
    inlineAssets: true,
    // Moloco IEC guide: "Ad file must not be compressed into .zip" — HTML-only, no ZIP.
    dualFormat: false,
  },
  molocoV2: {
    id: 'molocoV2',
    name: 'Moloco V2.0 (Launcher API)',
    format: 'launcher-payload',
    maxSize: MB5, // overall ceiling — sub-limits enforced via launcherPayload below
    mraid: true,
    inlineAssets: true,
    launcherPayload: {
      launcherMaxSize: 3 * 1024, // 3 KB strict
      payloadMaxSize: MB5,
      assetProvider: 'Playbox',
      assetVersion: '2.0',
      includeSplash: true, // PLBX branded loading splash; auto-hides on game_ready (~1.8 KB total, still < 3 KB)
    },
  },
  nefta: {
    id: 'nefta',
    name: 'Nefta',
    format: 'html',
    maxSize: 5 * 1024 * 1024,
    mraid: false,
    inlineAssets: true,
    dualFormat: true,
  },
  google: {
    id: 'google',
    name: 'Google Ads',
    format: 'zip',
    maxSize: MB5,
    mraid: false,
    sdkUrl:
      'https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js',
    singleFileZip: true,
    inlineAssets: false,
  },
  pangle: {
    id: 'pangle',
    name: 'Pangle',
    format: 'zip',
    maxSize: MB5,
    mraid: false,
    // Same union-fe-nc playable_sdk as TikTok; pstatp served a stale v3.4.1 build,
    // ibytedtos i18n is the current v3.49.0 that official Pangle docs instruct. Verified 2026-07-01.
    sdkUrl:
      'https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js',
    singleFileZip: true,
    inlineAssets: false,
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    format: 'zip',
    maxSize: MB5,
    mraid: false,
    sdkUrl:
      'https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js',
    singleFileZip: true,
    inlineAssets: false,
  },
  vungle: {
    id: 'vungle',
    name: 'Vungle',
    format: 'zip',
    maxSize: MB5,
    mraid: false,
    singleFileZip: true,
    inlineAssets: false,
  },
  mytarget: {
    id: 'mytarget',
    name: 'MyTarget',
    format: 'zip',
    maxSize: MB2,
    mraid: true,
    singleFileZip: true,
    inlineAssets: false,
  },
  mintegral: {
    id: 'mintegral',
    name: 'Mintegral',
    format: 'zip',
    maxSize: MB5,
    mraid: false,
    singleFileZip: true,
    inlineAssets: false,
    // Mintegral 2026 rule: the HTML inside the zip must match the playable
    // filename (the outer .zip basename), not index.html — else load fails.
    htmlMatchesZipName: true,
  },
  adikteev: {
    id: 'adikteev',
    name: 'Adikteev',
    format: 'zip',
    maxSize: MB5,
    mraid: true,
    singleFileZip: true,
    inlineAssets: false,
  },
  bigabid: {
    id: 'bigabid',
    name: 'Bigabid',
    format: 'zip',
    maxSize: MB5,
    mraid: true,
    singleFileZip: true,
    inlineAssets: false,
  },
  inmobi: {
    id: 'inmobi',
    name: 'inMobi',
    format: 'html',
    maxSize: MB5,
    mraid: true,
    inlineAssets: true,
  },
  snapchat: {
    id: 'snapchat',
    name: 'Snapchat',
    format: 'zip',
    maxSize: MB5,
    // Snapchat App Playables use ScPlayableAd.onCTAClick() and forbid mraid.js —
    // NOT MRAID. CTA handled by SnapchatAdapter/snapchatBridge. Verified 2026-07-01
    // (Snap App Playables spec + smoud/playable-sdk).
    mraid: false,
    zipConfig: { orientation: 1 },
    singleFileZip: true,
    inlineAssets: false,
  },
  bigo: {
    id: 'bigo',
    name: 'Bigo Ads',
    format: 'zip',
    maxSize: MB5,
    mraid: false,
    sdkUrl:
      'https://static-web.likeevideo.com/as/common-static/big-data/dsp-public/bgy-mraid-sdk.js',
    zipConfig: { orientation: 0 },
    singleFileZip: true,
    inlineAssets: false,
  },
  gdt: {
    id: 'gdt',
    name: 'GDT (Tencent)',
    format: 'zip',
    // 优量汇 spec: 包大小不大于3M. Verified 2026-07-01.
    maxSize: MB3,
    mraid: false,
    sdkUrl: 'https://qzs.gdtimg.com/union/res/union_sdk/page/unjs/unsdk.js',
    singleFileZip: true,
    inlineAssets: false,
  },
  kwai: {
    id: 'kwai',
    name: 'Kwai',
    format: 'zip',
    maxSize: MB5,
    mraid: false,
    singleFileZip: true,
    inlineAssets: false,
  },
  newsbreak: {
    id: 'newsbreak',
    name: 'NewsBreak',
    format: 'html',
    maxSize: MB5,
    mraid: false,
    inlineAssets: true,
  },
  luna: {
    id: 'luna',
    name: 'Luna (Unity Playworks)',
    format: 'zip',
    // Luna publishes no upload ceiling and does NOT compress or minify after
    // upload ("please minify and obfuscate your playables prior to uploading"),
    // so whatever we ship is what every downstream network gets. 5 MB is the
    // strictest common cap among them — an artifact above it is dead on arrival
    // at export time. Advisory; revise if Luna ever documents a real number.
    maxSize: MB5,
    // Luna injects the per-network SDK at export time, so our archive must carry
    // no wrapper of its own. false here also makes 'mraid.js' a forbidden string
    // (BaseAdapter.getForbiddenStrings), which is exactly what Luna wants.
    mraid: false,
    inlineAssets: true,
    singleFileZip: true,
    // Mandatory: Luna looks for source.html inside the archive.
    htmlFileName: 'source.html',
    zipStructure: '',
  },
  yandex: {
    id: 'yandex',
    name: 'Yandex',
    format: 'zip',
    maxSize: MB3,
    mraid: false,
    jsBundle: 'res.js',
    inlineAssets: false,
  },
}

export function getNetwork(id: string): NetworkConfig | undefined {
  return NETWORKS[id]
}

/** Effective size ceiling for a given output format. A network that caps its
 *  single-HTML output tighter than its ZIP total sets `htmlMaxSize`; with none
 *  set, `maxSize` governs both. */
export function maxSizeForFormat(
  net: NetworkConfig,
  format: OutputFormat,
): number {
  return format === 'html' && net.htmlMaxSize ? net.htmlMaxSize : net.maxSize
}

export function getNetworksByFormat(format: OutputFormat): NetworkConfig[] {
  return Object.values(NETWORKS).filter((n) => n.format === format)
}

export function getAllNetworks(): NetworkConfig[] {
  return Object.values(NETWORKS)
}

/**
 * Validator-forbidden substrings that apply to ONE network only, keyed by
 * network id. Merged into `BaseAdapter.getForbiddenStrings()`, so a hit aborts
 * that network's packaging (other networks are unaffected — the packager wraps
 * each one in its own try/catch).
 *
 * `window.top` — Unity Ads rejects a responsive playable on any occurrence:
 * "Your responsive playable is not allowed to use window.top". The scan is
 * static, so a dead reference is rejected exactly like a live one.
 */
export const NETWORK_FORBIDDEN_STRINGS: Record<string, string[]> = {
  // Unity Ads rejects a responsive playable on any occurrence — see above.
  unity: ['window.top'],
  // Mintegral PlayTurbo: "Please remove the strings related to 'preview-util.js'
  // from the comments." A comment counts. https://playturbo.mintegral.com
  mintegral: ['preview-util.js', 'preview-util'],
  // Moloco v2.0 spec §2.5 — the payload must not call out to non-Moloco
  // trackers. Guards against analytics SDKs the game pulled in by accident.
  molocoV2: [
    'google-analytics.com',
    'googletagmanager.com',
    'doubleclick.net',
    'facebook.net/en_US/fbevents.js',
    'connect.facebook.net',
  ],
}

/**
 * Remediation text attached to a forbidden-string hit, keyed by the substring.
 *
 * Most forbidden strings are OUR bug (a loader regression leaking `mraid.js`),
 * so the bare "aborting" message is enough — the fix is in this repo. The
 * Phaser `window.top` case is not: it comes from the game's engine build, and
 * the diagnosis is genuinely non-obvious, so the error carries the fix.
 */
export const FORBIDDEN_STRING_HINTS: Record<string, string> = {
  'window.top':
    'Phaser attaches its pointer listeners to window.top by default. ' +
    'Set `input: { windowEvents: false }` in the game config AND strip the ' +
    'dead `window.top` literal from the bundle — the flag is read at runtime, ' +
    'so bundlers keep the string either way and this static scan still fails. ' +
    'Fixing only one of the two is wrong in both directions: strings without ' +
    'the flag changes input behaviour, the flag without the strings still ' +
    'gets rejected. Side effect: POINTER_UP_OUTSIDE stops firing — verify any ' +
    'drag/swipe logic that depends on release outside the canvas.',
}

/**
 * Every validator-forbidden substring for one network: the `mraid.js` rule that
 * applies to all non-MRAID networks, plus that network's own entries.
 *
 * Lives here, not on the adapter, because the checklist builder
 * (`checks/network-checks.ts`) has to know the same list and must stay
 * fs-free — it is bundled into the preview panel. `BaseAdapter` delegates to
 * this so the packaging abort and the preview checklist can never disagree.
 */
export function forbiddenStringsFor(networkId: string): string[] {
  const extra = NETWORK_FORBIDDEN_STRINGS[networkId] ?? []
  const config = NETWORKS[networkId]
  // Non-MRAID networks (Moloco, Facebook, Snapchat, …) run a naive substring
  // scan over the raw HTML and reject the creative on any `mraid.js` hit —
  // including inside a JS comment or a dead conditional ("Playable shouldn't
  // include the 'mraid.js' function"). The emitted loader keeps the token
  // split (see loader/shared.ts) and drops whole-line comments, but that is
  // a convention someone can undo; this turns a silent regression into a
  // failed build.
  if (config && !config.mraid) return [...extra, 'mraid.js']
  return extra
}

