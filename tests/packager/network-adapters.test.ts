import { describe, it, expect } from 'vitest'
import { getAdapter } from '../../src/packager/network-adapters'
import {
  mraidDeferBootGate,
  mintegralBridge,
} from '../../src/packager/network-adapters/base'
import { HtmlBuilder } from '../../src/packager/html-builder'
import {
  NETWORKS,
  forbiddenStringsFor,
  FORBIDDEN_STRING_HINTS,
} from '../../src/networks'
import { PackageConfig } from '../../src/types'

const sampleHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Game</title></head>
<body><script src="assets/main.js"></script></body></html>`

const defaultConfig: PackageConfig = {
  storeUrlIos: 'https://apps.apple.com/app/123',
  storeUrlAndroid: 'https://play.google.com/store/apps/details?id=com.test',
  orientation: 'portrait',
}

describe('Network Adapters', () => {
  describe('getAdapter', () => {
    it('should return adapter for every registered network', () => {
      Object.keys(NETWORKS).forEach((id) => {
        expect(() => getAdapter(id)).not.toThrow()
      })
    })

    it('should throw for unknown network', () => {
      expect(() => getAdapter('nonexistent')).toThrow('Unknown network')
    })
  })

  describe('MRAID networks', () => {
    const mraidIds = [
      'applovin',
      'unity',
      'ironsource',
      'adcolony',
      'appreciate',
      'chartboost',
      'liftoff',
    ]

    mraidIds.forEach((id) => {
      it(`${id} should inject mraid.js`, () => {
        const adapter = getAdapter(id)
        const builder = new HtmlBuilder(sampleHtml)
        adapter.transform(builder, defaultConfig)
        expect(builder.toHtml()).toContain('mraid.js')
      })

      it(`${id} should inject defer-boot gate (__plbx_pre_boot) for video+playable combo`, () => {
        const adapter = getAdapter(id)
        const builder = new HtmlBuilder(sampleHtml)
        adapter.transform(builder, defaultConfig)
        const html = builder.toHtml()
        expect(html).toContain('__plbx_pre_boot')
        expect(html).toContain('mraid.isViewable')
        expect(html).toContain('viewableChange')
      })
    })

    it('non-MRAID networks should NOT inject __plbx_pre_boot gate', () => {
      ;[
        'facebook',
        'moloco',
        'google',
        'tiktok',
        'pangle',
        'mintegral',
      ].forEach((id) => {
        const adapter = getAdapter(id)
        const builder = new HtmlBuilder(sampleHtml)
        adapter.transform(builder, defaultConfig)
        expect(builder.toHtml()).not.toContain('__plbx_pre_boot')
      })
    })

    mraidIds.forEach((id) => {
      it(`${id} getRequiredStrings() should include gate + mraid.js`, () => {
        const adapter = getAdapter(id)
        const required = adapter.getRequiredStrings()
        expect(required).toContain('__plbx_pre_boot = function')
        expect(required).toContain('mraid.isViewable')
        expect(required).toContain('viewableChange')
        expect(required).toContain('mraid.js')
        // Lock the render-surface fallback so a future edit can't silently drop it
        // and reintroduce the Unity moderation grey-screen.
        expect(required).toContain('document.visibilityState')
      })
    })

    it('non-MRAID networks getRequiredStrings() should not include gate', () => {
      ;['facebook', 'moloco', 'google', 'tiktok', 'pangle', 'tapjoy'].forEach(
        (id) => {
          const adapter = getAdapter(id)
          const required = adapter.getRequiredStrings()
          expect(required).not.toContain('__plbx_pre_boot = function')
        },
      )
    })
  })

  // Regression: Unity Ads moderation rejected a packaged build as "content is
  // non-functional" — its headless screenshot showed a grey #333 screen because
  // Cocos never booted. Root cause: the naive defer-boot gate registered its
  // viewableChange listener only AFTER the base64-ZIP unpack (runtime-loader
  // calls __plbx_pre_boot post-unpack) and checked isViewable() exactly once. If
  // the network fired its first viewableChange(true) during the unpack window the
  // pulse was lost, and if isViewable() was false at that single check the game
  // hung forever. Verified by reproduction (mraid mock, modes never/early-pulse).
  describe('mraidDeferBootGate — robust boot (Unity moderation grey-screen fix)', () => {
    const gate = mraidDeferBootGate()

    it('polls isViewable() to catch a viewableChange pulse lost during ZIP unpack', () => {
      // Same proven pattern as the moloco-v2 viewable handler: a bounded poll
      // catches the already-viewable and missed-first-pulse cases that a single
      // event listener + one isViewable() check cannot.
      expect(gate).toMatch(/poll/i)
      expect(gate).toContain('setTimeout')
    })

    it('boots on a real, visible render surface when MRAID never reports viewable', () => {
      // Unity server-side moderation captures a screenshot without ever firing
      // viewableChange or returning isViewable()===true. Boot must still happen,
      // gated deterministically on a nonzero, visible viewport — NOT an arbitrary
      // "boot anyway after N ms" timer.
      expect(gate).toContain('document.visibilityState')
      expect(gate).toContain('innerWidth')
    })

    it('boots immediately when no MRAID is present (preview / validators)', () => {
      expect(gate).toContain('if (!window.mraid)')
    })
  })

  describe('AppLovin adapter', () => {
    it('should inject mraid.js', () => {
      const adapter = getAdapter('applovin')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      expect(builder.toHtml()).toContain('mraid.js')
    })

    it('should inject viewport meta tag', () => {
      const adapter = getAdapter('applovin')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('user-scalable=no')
    })

    it('getRequiredStrings() should include viewport', () => {
      const adapter = getAdapter('applovin')
      expect(adapter.getRequiredStrings()).toContain('user-scalable=no')
    })

    it('should use mraid.open() for CTA bridge', () => {
      const adapter = getAdapter('applovin')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('mraid.open')
    })

    it('sets window.super_html_channel so super-html-aware games route CTA via super_html.download()', () => {
      // train-miner et al. detect the build via window.super_html_channel and
      // call super_html.download() (aliased to plbx_html.download → mraid.open).
      // Without it they fall to window.open(link), which an MRAID container blocks.
      const adapter = getAdapter('applovin')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('window.super_html_channel = "applovin"')
      // super_html must be an alias of plbx_html (so super_html.download works).
      expect(html).toContain(
        'window.super_html = window.super_html || window.plbx_html',
      )
    })

    it('should inject store URLs', () => {
      const adapter = getAdapter('applovin')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('apps.apple.com/app/123')
      expect(html).toContain('play.google.com/store/apps')
    })
  })

  describe('Google adapter', () => {
    it('should inject ExitAPI script', () => {
      const adapter = getAdapter('google')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('exitapi.js')
    })

    it('should declare both orientations regardless of config.orientation', () => {
      const adapter = getAdapter('google')
      for (const orientation of ['portrait', 'landscape'] as const) {
        const builder = new HtmlBuilder(sampleHtml)
        adapter.transform(builder, { ...defaultConfig, orientation })
        expect(builder.toHtml()).toContain(
          '<meta name="ad.orientation" content="portrait,landscape">',
        )
      }
    })

    it('should emit three artifact variants swapping only the head meta', () => {
      const adapter = getAdapter('google')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()

      const variants = adapter.getArtifactVariants(defaultConfig)
      expect(variants.map((v) => v.suffix)).toEqual([
        '',
        '_portrait',
        '_landscape',
      ])

      const [primary, portrait, landscape] = variants.map((v) =>
        v.transformHtml(html),
      )
      expect(primary).toBe(html)
      // Both tags: ad.orientation is what App campaigns read and it overrides
      // ad.size, which stays for the older size-only surfaces.
      expect(portrait).toContain(
        '<meta name="ad.orientation" content="portrait">',
      )
      expect(portrait).toContain(
        '<meta name="ad.size" content="width=320,height=480">',
      )
      expect(landscape).toContain(
        '<meta name="ad.orientation" content="landscape">',
      )
      expect(landscape).toContain(
        '<meta name="ad.size" content="width=480,height=320">',
      )
      // Only the two supported dimensions are ever declared — never the real canvas.
      expect(portrait + landscape).not.toMatch(
        /content="width=(?!320,height=480|480,height=320)/,
      )
      const strip = (h: string) =>
        h.replace(/<meta name="ad\.(size|orientation)"[^>]*>/g, '')
      for (const v of [portrait, landscape]) {
        // Identical apart from the meta tags.
        expect(strip(v)).toBe(strip(html))
      }
    })

    it('should inject clickTag variable with Google macro default', () => {
      const adapter = getAdapter('google')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('var clickTag')
      expect(html).toContain('%%CLICK_URL_UNESC%%')
    })
  })

  describe('Facebook adapter', () => {
    it('should reference FbPlayableAd.onCTAClick() in the CTA bridge', () => {
      const adapter = getAdapter('facebook')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      // Bridge must CALL FbPlayableAd.onCTAClick(), not assign to it
      expect(html).toContain('FbPlayableAd.onCTAClick()')
      expect(html).toContain('if (window.FbPlayableAd)')
    })

    it('MUST NOT overwrite FbPlayableAd.onCTAClick (validator provides it)', () => {
      // Regression guard for a bug where the adapter injected
      //   var FbPlayableAd = FbPlayableAd || {};
      //   FbPlayableAd.onCTAClick = function() {};
      // which replaced the validator's real CTA handler with a no-op and
      // silently killed click tracking on Meta / Moloco.
      const adapter = getAdapter('facebook')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).not.toMatch(/FbPlayableAd\.onCTAClick\s*=/)
      expect(html).not.toMatch(/var\s+FbPlayableAd\s*=/)
    })

    it('defines window.install → FbPlayableAd.onCTAClick (game CTA dispatchers bypass plbx_html.download)', () => {
      // Some game CTA code calls window.install()/window.open() directly. In FB's
      // sandboxed frame window.open is blocked ('allow-popups' not set) and the
      // validator never sees the click. window.install must route to the FB SDK.
      const adapter = getAdapter('facebook')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toMatch(/window\.install\s*=\s*function/)
      const installBlock = html.slice(html.indexOf('window.install'))
      expect(installBlock).toContain('FbPlayableAd.onCTAClick()')
    })
  })

  describe('Moloco adapter', () => {
    it('should reference FbPlayableAd.onCTAClick() in the CTA bridge (same as Facebook)', () => {
      const adapter = getAdapter('moloco')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('FbPlayableAd.onCTAClick()')
      expect(html).toContain('if (window.FbPlayableAd)')
    })

    it('MUST NOT overwrite FbPlayableAd.onCTAClick (validator provides it)', () => {
      const adapter = getAdapter('moloco')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).not.toMatch(/FbPlayableAd\.onCTAClick\s*=/)
      expect(html).not.toMatch(/var\s+FbPlayableAd\s*=/)
    })
  })

  describe('Snapchat adapter', () => {
    it('should reference ScPlayableAd.onCTAClick() in the CTA bridge (not mraid)', () => {
      const adapter = getAdapter('snapchat')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('ScPlayableAd.onCTAClick()')
      expect(html).toContain('if (window.ScPlayableAd)')
    })

    it('MUST NOT inject mraid.js or use the mraid bridge (Snap forbids MRAID)', () => {
      const adapter = getAdapter('snapchat')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).not.toContain('mraid.open')
      expect(html).not.toMatch(/src=["']mraid\.js["']/)
    })

    it('defines window.install → ScPlayableAd.onCTAClick (game CTA dispatchers bypass plbx_html.download)', () => {
      const adapter = getAdapter('snapchat')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toMatch(/window\.install\s*=\s*function/)
      const installBlock = html.slice(html.indexOf('window.install'))
      expect(installBlock).toContain('ScPlayableAd.onCTAClick()')
    })
  })

  describe('Mintegral adapter', () => {
    it('should inject Mintegral viewport meta', () => {
      const adapter = getAdapter('mintegral')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('user-scalable=no')
    })

    it('should use install()-based CTA bridge (not mraid)', () => {
      const adapter = getAdapter('mintegral')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('window.install')
      expect(html).not.toContain('mraid.open')
    })

    it('should bridge game_end to window.gameEnd', () => {
      const adapter = getAdapter('mintegral')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('gameEnd')
      expect(html).toContain('gameClose')
    })

    // PlayTurbo §5/§7: the container calls the creative's gameStart/gameClose.
    // They used to be guarded no-op stubs, so the call reached nothing and a
    // game had no way to hook the spec's own use cases (start the countdown or
    // the BGM; stop the BGM).
    const mintegralHtml = () => {
      const adapter = getAdapter('mintegral')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      return builder.toHtml()
    }

    it('dispatches gameStart/gameClose to plbx_html subscribers', () => {
      const html = mintegralHtml()
      expect(html).toContain('window.plbx_html.on_game_start')
      expect(html).toContain('window.plbx_html.on_game_close')
      // not a stub any more
      expect(html).not.toContain('window.gameClose = function() {};')
    })

    it('never calls gameClose itself — the container owns that timing', () => {
      // download() ran the game's end-of-ad cleanup on a CTA tap; game_end()
      // ran it a second time. The bridge must not mention gameClose at all —
      // only the dispatcher in mintegralLifecycle owns that global.
      const bridge = mintegralBridge()
      expect(bridge).not.toContain('gameClose')
      expect(bridge).toContain('window.gameEnd')
      expect(bridge).toContain('window.gameRetry')
    })

    it('exposes game_retry for replay creatives (§6)', () => {
      const html = mintegralHtml()
      expect(html).toContain('game_retry')
      expect(html).toContain('window.gameRetry')
    })

    it('keeps a game-assigned gameStart instead of hijacking it', () => {
      // The spec's own example is `function gameStart() { … }` in the playable,
      // so a game may already own the global by the time we install ours.
      const html = mintegralHtml()
      expect(html).toContain(
        "var priorStart = typeof window.gameStart === 'function' ? window.gameStart : null",
      )
      expect(html).toContain('priorStart()')
    })

    it('calls a late subscriber immediately when the container already fired', () => {
      // Cocos boots asynchronously — a scene subscribing in onLoad is routinely
      // later than gameStart, and silently missing it is the original bug.
      const html = mintegralHtml()
      expect(html).toContain('if (fired) { try { cb(); } catch (e) {} }')
    })

    it('should declare preview-util.js as forbidden string', () => {
      const adapter = getAdapter('mintegral')
      const forbidden = adapter.getForbiddenStrings()
      expect(forbidden).toContain('preview-util.js')
    })

    it('transformed HTML must not contain any forbidden string', () => {
      const adapter = getAdapter('mintegral')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      for (const needle of adapter.getForbiddenStrings()) {
        expect(
          html,
          `adapter-transformed HTML leaked "${needle}"`,
        ).not.toContain(needle)
      }
    })
  })

  describe('Forbidden strings API (base)', () => {
    it('mraid:false adapters forbid mraid.js — their validators grep the raw HTML', () => {
      for (const id of ['facebook', 'moloco', 'google', 'tiktok', 'pangle']) {
        expect(getAdapter(id).getForbiddenStrings()).toContain('mraid.js')
      }
    })

    it('MRAID adapters never forbid mraid.js — they must ship it', () => {
      for (const id of ['applovin', 'unity', 'ironsource']) {
        expect(getAdapter(id).getForbiddenStrings()).not.toContain('mraid.js')
      }
    })

    it('applovin declares no forbidden strings', () => {
      expect(getAdapter('applovin').getForbiddenStrings()).toEqual([])
    })

    // Unity Ads rejects a responsive playable on any window.top occurrence.
    // Phaser's input manager emits it by default, so a Phaser build reaches
    // upload looking fine and comes back rejected — this fails it at packaging.
    it('unity forbids window.top on top of the MRAID defaults', () => {
      expect(getAdapter('unity').getForbiddenStrings()).toEqual(['window.top'])
    })

    it('window.top is forbidden for unity only, not for every MRAID network', () => {
      for (const id of ['applovin', 'ironsource', 'adcolony']) {
        expect(getAdapter(id).getForbiddenStrings()).not.toContain('window.top')
      }
    })

    it('adapters and the checklist read the same list — no adapter overrides', () => {
      // mintegral and molocoV2 used to override getForbiddenStrings(), which the
      // fs-free checklist builder could not see. Both now live in the registry.
      for (const id of Object.keys(NETWORKS)) {
        expect(getAdapter(id).getForbiddenStrings()).toEqual(
          forbiddenStringsFor(id),
        )
      }
    })

    it('keeps the network-specific lists that were adapter overrides', () => {
      expect(getAdapter('mintegral').getForbiddenStrings()).toContain(
        'preview-util.js',
      )
      expect(getAdapter('mintegral').getForbiddenStrings()).toContain('mraid.js')
      expect(getAdapter('molocoV2').getForbiddenStrings()).toContain(
        'connect.facebook.net',
      )
      // molocoV2 is mraid:true — its launcher ships the tag and must not forbid it.
      expect(getAdapter('molocoV2').getForbiddenStrings()).not.toContain(
        'mraid.js',
      )
    })

    it('a forbidden string carrying a hint explains the fix', () => {
      // The bare "aborting" message is a dead end for window.top: the fix is in
      // the game's engine config, not in this repo.
      const hint = FORBIDDEN_STRING_HINTS['window.top']
      expect(hint).toContain('windowEvents')
      expect(hint).toContain('POINTER_UP_OUTSIDE')
    })
  })

  describe('TikTok adapter', () => {
    it('should inject TikTok SDK', () => {
      const adapter = getAdapter('tiktok')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      expect(builder.toHtml()).toContain('playable/sdk/playable-sdk.js')
    })

    it('should use playableSDK.openAppStore() for CTA bridge', () => {
      const adapter = getAdapter('tiktok')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('playableSDK.openAppStore()')
    })

    // The live playable-sdk.js exposes 39 methods and has NEITHER
    // reportGameReady nor reportGameClose. The bridge used to call both behind
    // a typeof guard that never passed in production, so game_ready/game_end
    // were silent no-ops — while the preview mock manufactured the methods and
    // the checklist went green over dead code. TikTok's spec asks the creative
    // for one call only: window.openAppStore().
    it('does not call lifecycle methods the SDK has never had', () => {
      const adapter = getAdapter('tiktok')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).not.toContain('reportGameReady')
      expect(html).not.toContain('reportGameClose')
      // CTA is the one call the spec does require, and it stays.
      expect(html).toContain('playableSDK.openAppStore()')
    })

    it('should inject viewport meta tag', () => {
      const adapter = getAdapter('tiktok')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('user-scalable=no')
    })

    it('should return zipConfig with orientation for portrait', () => {
      const adapter = getAdapter('tiktok')
      const config = adapter.getZipConfig({
        ...defaultConfig,
        orientation: 'portrait',
      })
      expect(config).toEqual({ playable_orientation: 1 })
    })

    it('should return zipConfig with orientation for landscape', () => {
      const adapter = getAdapter('tiktok')
      const config = adapter.getZipConfig({
        ...defaultConfig,
        orientation: 'landscape',
      })
      expect(config).toEqual({ playable_orientation: 2 })
    })

    it('should return zipConfig with orientation for auto', () => {
      const adapter = getAdapter('tiktok')
      const config = adapter.getZipConfig({
        ...defaultConfig,
        orientation: 'auto',
      })
      expect(config).toEqual({ playable_orientation: 0 })
    })

    it('should NOT use mraid bridge', () => {
      const adapter = getAdapter('tiktok')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).not.toContain('mraid.open')
      expect(html).not.toContain('mraid.js')
    })

    it('should NOT use generic window.open as primary CTA', () => {
      const adapter = getAdapter('tiktok')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      // The bridge should check playableSDK first, window.open only as fallback
      expect(html).toContain('if (window.playableSDK)')
    })
  })

  describe('Pangle adapter', () => {
    it('should inject Pangle SDK', () => {
      const adapter = getAdapter('pangle')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      expect(builder.toHtml()).toContain('playable-sdk.js')
    })

    it('should use playableSDK.openAppStore() for CTA bridge', () => {
      const adapter = getAdapter('pangle')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('playableSDK.openAppStore()')
    })

    // The live playable-sdk.js exposes 39 methods and has NEITHER
    // reportGameReady nor reportGameClose. The bridge used to call both behind
    // a typeof guard that never passed in production, so game_ready/game_end
    // were silent no-ops — while the preview mock manufactured the methods and
    // the checklist went green over dead code. TikTok's spec asks the creative
    // for one call only: window.openAppStore().
    it('does not call lifecycle methods the SDK has never had', () => {
      const adapter = getAdapter('pangle')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).not.toContain('reportGameReady')
      expect(html).not.toContain('reportGameClose')
      // CTA is the one call the spec does require, and it stays.
      expect(html).toContain('playableSDK.openAppStore()')
    })

    it('should inject viewport meta tag', () => {
      const adapter = getAdapter('pangle')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain('user-scalable=no')
    })

    it('should return zipConfig with orientation', () => {
      const adapter = getAdapter('pangle')
      const config = adapter.getZipConfig({
        ...defaultConfig,
        orientation: 'portrait',
      })
      expect(config).toEqual({ playable_orientation: 1 })
    })
  })

  describe('Snapchat adapter', () => {
    it('should return zipConfig with orientation', () => {
      const adapter = getAdapter('snapchat')
      const config = adapter.getZipConfig({
        ...defaultConfig,
        orientation: 'portrait',
      })
      expect(config).toHaveProperty('orientation')
    })
  })

  describe('Vungle adapter', () => {
    it('emits parent.postMessage("download") as the CTA bridge', () => {
      const adapter = getAdapter('vungle')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain(`parent.postMessage('download', '*')`)
    })

    it('emits parent.postMessage("complete") from game_end, not from CTA', () => {
      const adapter = getAdapter('vungle')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).toContain(`parent.postMessage('complete', '*')`)
      // The two postMessage calls must not share the same function body —
      // otherwise a single CTA tap would also fire game_end, or vice versa.
      const downloadFn = html.slice(
        html.indexOf('download: function'),
        html.indexOf('game_end:'),
      )
      expect(downloadFn).not.toContain('complete')
    })

    it('never navigates to the store itself — window.open is trapped, not used', () => {
      const adapter = getAdapter('vungle')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      // Vungle tracks neither window.open nor window.install, and an Adaptive
      // Creative must not reach the store directly ("Do not use the download event
      // without user interaction" / no direct store links). So the bridge must not
      // OPEN anything...
      expect(html).not.toContain(`window.open(url`)
      expect(html).not.toContain(`_blank`)
      // ...but it must still catch the games whose CTA dispatcher bypasses
      // plbx_html.download() and calls window.open / window.install on its own —
      // otherwise their click vanishes exactly as it did before this adapter.
      expect(html).toContain(`window.open = function(u)`)
      expect(html).toContain(`window.install = function()`)
    })

    it('routes a bypassing window.open / window.install into the download postMessage', () => {
      const adapter = getAdapter('vungle')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()

      const openFn = html.slice(
        html.indexOf('window.open = function(u)'),
        html.indexOf('window.plbx_html.game_end ='),
      )
      expect(openFn).toContain(`parent.postMessage('download', '*')`)
      // The trap must never fire completion: Vungle forbids download and complete
      // firing together.
      expect(openFn).not.toContain('complete')

      const installFn = html.slice(
        html.indexOf('window.install = function()'),
        html.indexOf('window.open = function(u)'),
      )
      expect(installFn).toContain(`parent.postMessage('download', '*')`)
      expect(installFn).not.toContain('complete')
    })

    it('MUST NOT inject mraid.js or use the mraid bridge (Vungle is non-MRAID)', () => {
      const adapter = getAdapter('vungle')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).not.toContain('mraid.open')
      expect(html).not.toMatch(/src=["']mraid\.js["']/)
    })

    it('declares mraid.js as forbidden (mraid:false network)', () => {
      expect(getAdapter('vungle').getForbiddenStrings()).toContain('mraid.js')
    })

    it('transformed HTML must not contain any forbidden string', () => {
      const adapter = getAdapter('vungle')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      for (const needle of adapter.getForbiddenStrings()) {
        expect(html, `Vungle HTML leaked "${needle}"`).not.toContain(needle)
      }
    })

    it('injects a globalThis shim before every other script (old WebView predates globalThis)', () => {
      const adapter = getAdapter('vungle')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      const shim = 'window.globalThis=window.globalThis||window;'
      const shimAt = html.indexOf(shim)
      const bridgeAt = html.indexOf('window.plbx_html = window.plbx_html ||')
      expect(shimAt).toBeGreaterThan(-1)
      expect(bridgeAt).toBeGreaterThan(-1)
      expect(shimAt).toBeLessThan(bridgeAt)
    })

    it('a non-Vungle network does not carry the globalThis shim', () => {
      const adapter = getAdapter('facebook')
      const builder = new HtmlBuilder(sampleHtml)
      adapter.transform(builder, defaultConfig)
      const html = builder.toHtml()
      expect(html).not.toContain('window.globalThis=window.globalThis||window;')
    })
  })

  describe('Non-MRAID networks without SDK', () => {
    ;['tapjoy', 'smadex', 'rubeex'].forEach((id) => {
      it(`${id} should not inject mraid.js`, () => {
        const adapter = getAdapter(id)
        const builder = new HtmlBuilder(sampleHtml)
        adapter.transform(builder, defaultConfig)
        expect(builder.toHtml()).not.toContain('mraid.js')
      })
    })
  })

  describe('network SDK tag position', () => {
    const html = '<!DOCTYPE html><html><head></head><body><canvas></canvas></body></html>'
    const config = { orientation: 'portrait' as const }

    for (const id of ['tiktok', 'pangle', 'bigo', 'gdt']) {
      it(`${id}: the SDK script sits at the end of body, BEFORE the bridge`, () => {
        const b = new HtmlBuilder(html)
        getAdapter(id).transform(b, config)
        const out = b.toHtml()
        const sdkAt = out.indexOf('<script src="https://')
        const bridgeAt = out.indexOf('window.plbx_html = window.plbx_html ||')
        const lifecycleAt = out.indexOf('visibilitychange')
        expect(sdkAt).toBeGreaterThan(out.indexOf('<canvas'))
        expect(sdkAt).toBeLessThan(out.indexOf('</body>'))
        expect(out.indexOf('</head>')).toBeLessThan(sdkAt)
        expect(sdkAt).toBeLessThan(bridgeAt)
        expect(sdkAt).toBeLessThan(lifecycleAt)
      })
    }

    it('google keeps exitapi.js in head', () => {
      const b = new HtmlBuilder(html)
      getAdapter('google').transform(b, config)
      const out = b.toHtml()
      expect(out.indexOf('exitapi.js')).toBeLessThan(out.indexOf('</head>'))
    })
  })
})
