import { getNetwork } from '../networks'

export const CTA_LABELS: Record<string, string> = {
  facebook: 'CTA (FbPlayableAd.onCTAClick)',
  moloco: 'CTA (FbPlayableAd.onCTAClick)',
  google: 'CTA (ExitApi.exit)',
  mintegral: 'CTA (window.install)',
  tiktok: 'CTA (playableSDK.openAppStore)',
  pangle: 'CTA (playableSDK.openAppStore)',
  bigo: 'CTA (BGY_MRAID.open)',
  vungle: 'CTA (postMessage download)',
  mytarget: 'CTA (MTRG.onCTAClick)',
  yandex: 'CTA (yandexHTML5BannerApi)',
}

// Networks requiring full gameReady/gameStart/gameEnd/gameClose lifecycle
const FULL_LIFECYCLE = new Set(['mintegral'])

// Networks requiring gameReady + gameStart (SDK calls gameStart after gameReady)
const PARTIAL_LIFECYCLE = new Set(['tiktok', 'pangle'])

// Networks where game_end/complete is explicitly validated
const GAME_END_REQUIRED = new Set(['mintegral', 'vungle', 'tiktok', 'pangle'])

export interface CheckDef {
  id: string
  label: string
  hint?: string
}

// MolocoV2 macros tracked individually in the validator UI. Listed once here so the
// checklist + the macro-fire UI stay consistent.
export const MOLOCO_V2_TRACKED_MACROS: ReadonlyArray<{
  key: string
  label: string
  hint: string
}> = [
  {
    key: 'mraid_viewable',
    label: 'mraid_viewable beacon',
    hint: 'Fires after mraid.isViewable() becomes true. Trigger the "Viewable" button in the preview to simulate it.',
  },
  {
    key: 'game_viewable',
    label: 'game_viewable beacon',
    hint: 'Fires after plbx_html.game_ready() — Cocos boot signals the game is ready to display.',
  },
  {
    key: 'click',
    label: 'click beacon',
    hint: 'Fires from plbx_html.download() — tap the CTA in the playable.',
  },
  {
    key: 'engagement',
    label: 'engagement beacon',
    hint: 'Fires after taps_for_engagement taps (default 1). Use "Simulate N taps" or tap the canvas.',
  },
  {
    key: 'redirection',
    label: 'redirection beacon',
    hint: 'Fires after taps_for_redirection taps (default 3). Sustained engagement signal.',
  },
  {
    key: 'complete',
    label: 'complete beacon',
    hint: 'Fires from plbx_html.game_end() — call from game code on level finished or use "End game".',
  },
]

export function getNetworkChecks(
  networkId: string,
  mraid: boolean,
): CheckDef[] {
  const checks: CheckDef[] = [
    {
      id: 'file_size',
      label: 'File size',
      hint: 'Reduce asset sizes: compress textures (TinyPNG), use audio compression, remove unused assets. PLBX auto-inlines everything into a single HTML.',
    },
    {
      id: 'game_loads',
      label: 'Game loads',
      hint: 'Check browser console for errors. Ensure all assets are inlined and no external dependencies are missing.',
    },
  ]

  // MolocoV2 launcher-payload format: per-macro lifecycle checks. Skip the generic
  // CTA/external-request rails since the macro suite covers them more precisely.
  if (networkId === 'molocoV2') {
    checks.push({
      id: 'mraid_ready',
      label: 'MRAID ready',
      hint: 'mraid.js mock must initialize. Defer-boot gate waits for mraid.getState() === default.',
    })
    checks.push({
      id: 'viewable_listener',
      label: 'viewableChange listener registered',
      hint: 'Payload must call mraid.addEventListener("viewableChange", fn) so mraid_viewable fires in production.',
    })
    for (const macro of MOLOCO_V2_TRACKED_MACROS) {
      checks.push({
        id: 'macro_' + macro.key,
        label: macro.label,
        hint: macro.hint,
      })
    }
    checks.push({
      id: 'final_url_used',
      label: 'final_url consumed by CTA',
      hint: 'plbx_html.download() must open MOLOCO_MACROS.final_url via mraid.open — not the storeUrl fallback.',
    })
    checks.push({
      id: 'no_errors',
      label: 'No code exceptions',
      hint: 'Fix JavaScript errors in your game code. Common causes: missing assets, API calls to undefined objects, timing issues.',
    })
    return checks
  }

  // MRAID ready — for MRAID networks (AppLovin, Unity, ironSource, etc.)
  if (mraid) {
    checks.push({
      id: 'mraid_ready',
      label: 'MRAID ready',
      hint: 'MRAID SDK must initialize. PLBX injects mraid.js mock automatically. If not firing, check that your code listens for mraid "ready" event.',
    })
  }

  // Forbidden literals — non-MRAID networks' upload validators (Moloco,
  // Facebook, …) run a naive substring scan over the raw HTML and reject the
  // creative on any 'mraid.js' hit, even inside a comment or a conditional.
  // Evaluated statically against the built HTML server-side
  // (findForbiddenLiterals / net.forbiddenLiterals).
  if (!mraid) {
    checks.push({
      id: 'no_forbidden_literals',
      label: "No 'mraid.js' literal in built HTML",
      hint: "The network's upload validator greps the raw HTML and rejects any 'mraid.js' occurrence — even in a comment or a string check. Builds from older packagers leaked it via the loader; repackage with the current kit.",
    })
  }

  // Store URL literals — required by networks whose validator greps the raw HTML
  // for them (e.g. Unity Creative Pack). Evaluated statically against the built
  // HTML server-side (see buildStoreUrlPresence / net.hasGooglePlayUrl + hasAppStoreUrl).
  if (getNetwork(networkId)?.requiresStoreUrl) {
    checks.push({
      id: 'google_play_url',
      label: 'Google Play Store URL present',
      hint: 'The build must contain a Google Play Store URL as plaintext — validators grep the raw HTML. Set it in game code via set_google_play_url("https://play.google.com/store/apps/details?id=...") so the packager mirrors it into the build.',
    })
    checks.push({
      id: 'app_store_url',
      label: 'App Store URL present',
      hint: 'The build must contain an App Store URL as plaintext — validators grep the raw HTML. Set it in game code via set_app_store_url("https://apps.apple.com/app/id...") so the packager mirrors it into the build.',
    })
  }

  // Full lifecycle: Mintegral requires gameReady → gameStart → gameEnd → gameClose
  if (FULL_LIFECYCLE.has(networkId)) {
    checks.push({
      id: 'game_ready',
      label: 'gameReady()',
      hint: "Call window.gameReady() when all assets are loaded and the game is ready to play. In Cocos Creator, call it in your main scene's onLoad or start method.",
    })
    checks.push({
      id: 'game_start',
      label: 'gameStart()',
      hint: 'gameStart() is called automatically by the SDK after gameReady(). If not detected, ensure gameReady() is being called first.',
    })
  }

  // Partial lifecycle: TikTok/Pangle require gameReady + gameStart
  if (PARTIAL_LIFECYCLE.has(networkId)) {
    checks.push({
      id: 'game_ready',
      label: 'gameReady()',
      hint: 'Call window.gameReady() when the game is ready. For TikTok/Pangle, also call playableSDK.reportGameReady() if using their SDK.',
    })
    checks.push({
      id: 'game_start',
      label: 'gameStart()',
      hint: 'gameStart() is triggered after gameReady(). Ensure gameReady() fires correctly.',
    })
  }

  // CTA — with network-specific label
  const ctaLabel =
    CTA_LABELS[networkId] || (mraid ? 'CTA (mraid.open)' : 'CTA Call')
  const ctaHints: Record<string, string> = {
    mintegral:
      'Call window.install() when the user taps the CTA button. This redirects to the app store.',
    google: 'Call ExitApi.exit() when the user taps the CTA button.',
    facebook:
      'Call FbPlayableAd.onCTAClick() when the user taps the download/CTA button.',
    moloco: 'Call FbPlayableAd.onCTAClick() when the user taps the CTA button.',
    tiktok:
      'Call playableSDK.openAppStore() when the user taps the CTA button.',
    pangle:
      'Call playableSDK.openAppStore() when the user taps the CTA button.',
    bigo: 'Call BGY_MRAID.open(storeUrl) when the user taps the CTA button.',
    vungle:
      'Call parent.postMessage("download", "*") when the user taps the CTA button.',
    mytarget: 'Call MTRG.onCTAClick() when the user taps the CTA button.',
    yandex:
      'Call yandexHTML5BannerApi.getClickURLNum(1) when the user taps the CTA button.',
  }
  checks.push({
    id: 'cta',
    label: ctaLabel,
    hint:
      ctaHints[networkId] ||
      (mraid
        ? 'Call mraid.open(storeUrl) when the user taps the CTA button.'
        : 'Trigger a CTA call when the user taps the download button. Use the network-specific API.'),
  })

  // game_end — required for Mintegral (gameEnd), Vungle (complete event)
  if (GAME_END_REQUIRED.has(networkId)) {
    // Vungle is the exception: `complete` and the CTA's `download` must NEVER fire
    // together (Adaptive Creative Dos and Don'ts), which is the opposite of the
    // Mintegral rule below. It also has to travel through the bridge — a bare
    // window.gameEnd() would satisfy this checklist while the container never hears
    // the `complete` postMessage in production.
    const gameEndHint =
      networkId === 'vungle'
        ? 'Call plbx_html.game_end() when the gameplay is complete — it posts parent.postMessage("complete", "*"). Vungle requires this AFTER a good portion of the ad has played, and it must NEVER fire together with the CTA.'
        : 'Call window.gameEnd() when the gameplay is complete (e.g. level finished, time ran out). This must fire before or alongside the CTA.'
    checks.push({
      id: 'game_end',
      label: 'gameEnd()',
      hint: gameEndHint,
    })
  }

  // game_close — Mintegral only
  if (FULL_LIFECYCLE.has(networkId)) {
    checks.push({
      id: 'game_close',
      label: 'gameClose()',
      hint: 'Call window.gameClose() when the playable ad is being closed. Typically called after CTA or at the end of the experience.',
    })
  }

  checks.push({
    id: 'no_external',
    label: 'No external requests',
    hint: 'All assets must be inlined into the HTML file. PLBX does this automatically during packaging. If external requests appear, check for hardcoded URLs in your code.',
  })
  checks.push({
    id: 'no_errors',
    label: 'No code exceptions',
    hint: 'Fix JavaScript errors in your game code. Check the console below for details. Common causes: missing assets, API calls to undefined objects, timing issues.',
  })

  return checks
}
