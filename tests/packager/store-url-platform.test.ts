import { describe, expect, it } from 'vitest'
import { getAdapter } from '../../src/packager/network-adapters'
import { HtmlBuilder } from '../../src/packager/html-builder'
import { NETWORKS } from '../../src/networks'
import type { PackageConfig } from '../../src/types'

/**
 * The CTA must land in the store the DEVICE can install from.
 *
 * `plbx_html.download()` used to resolve `google_play_url || appstore_url`
 * unconditionally, so an iPhone that tapped the CTA was sent to Google Play —
 * a dead end on iOS. Game code cannot work around it: network validators grep
 * the raw HTML for BOTH store URLs as plaintext (checks/network-checks.ts),
 * so a creative is not allowed to publish only the one for the current device.
 * The pick therefore belongs here, in the bridge.
 */

const IOS_URL = 'https://apps.apple.com/app/id1'
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.test'

const config: PackageConfig = {
  storeUrlIos: IOS_URL,
  storeUrlAndroid: ANDROID_URL,
  orientation: 'portrait',
}

type Nav = { userAgent: string; platform?: string; maxTouchPoints?: number }

const IPHONE: Nav = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  platform: 'iPhone',
  maxTouchPoints: 5,
}
const ANDROID: Nav = {
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Mobile Safari/537.36',
  platform: 'Linux armv8l',
  maxTouchPoints: 5,
}
// iPadOS ships the desktop Safari UA on purpose — no "iPad" in it. The only
// reliable tell is the Mac platform string paired with a touch screen.
const IPADOS: Nav = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  platform: 'MacIntel',
  maxTouchPoints: 5,
}
const DESKTOP_MAC: Nav = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  platform: 'MacIntel',
  maxTouchPoints: 0,
}

type Win = Record<string, unknown>

/**
 * Boots an adapter's injected scripts against a fake window with no container
 * SDK present, so every bridge falls through to opening the URL it resolved —
 * which is the value under test. Returns everything the page tried to open,
 * whether via window.open or a location.href assignment (Mintegral's iPhone
 * branch navigates in place).
 */
function boot(
  networkId: string,
  nav: Nav,
  cfg: PackageConfig = config,
  preset: Win = {},
) {
  const builder = new HtmlBuilder(
    '<!DOCTYPE html><html><head></head><body></body></html>',
  )
  getAdapter(networkId).transform(builder, cfg)
  const scripts = [
    ...builder.toHtml().matchAll(/<script>([\s\S]*?)<\/script>/g),
  ].map((m) => m[1])

  const dests: string[] = []
  const console = { log: () => {}, info: () => {}, warn: () => {}, error: () => {} }
  const win: Win = {
    navigator: nav,
    location: {
      get href() {
        return ''
      },
      set href(v: string) {
        dests.push(v)
      },
    },
    open: (u: string) => {
      dests.push(u)
      return null
    },
    console,
    addEventListener: () => {},
    removeEventListener: () => {},
    document: { querySelectorAll: () => [], addEventListener: () => {} },
    setTimeout: () => 0,
    postMessage: () => {},
    innerWidth: 320,
    innerHeight: 480,
    ...preset,
  }
  for (const code of scripts) {
    try {
      new Function(
        'window',
        'parent',
        'document',
        'setTimeout',
        'navigator',
        'console',
        'mraid',
        code,
      )(win, win, win.document, () => 0, nav, console, win.mraid)
    } catch {
      /* network SDK shims are not under test here */
    }
  }
  const bridge = (win.plbx_html ?? {}) as Record<string, (...a: unknown[]) => unknown>
  return { win, bridge, dests }
}

/** What a plain `download()` sent the device to, or '' if nothing opened. */
function ctaTarget(networkId: string, nav: Nav, cfg?: PackageConfig): string {
  const { bridge, dests } = boot(networkId, nav, cfg)
  bridge.download?.()
  return dests[0] ?? ''
}

/**
 * Networks whose bridge resolves the destination ITSELF (rather than handing
 * the CTA to a container SDK that owns the click-through). Derived rather than
 * hardcoded so a new adapter is covered the day it lands.
 */
const SELF_ROUTING = Object.keys(NETWORKS).filter(
  (id) => ctaTarget(id, ANDROID) !== '',
)

describe('CTA store URL follows the device', () => {
  // Guards the derivation above: if codegen breaks, every bridge silently
  // opens nothing and the per-network assertions all vacuously pass.
  it('covers the networks that route the CTA themselves', () => {
    expect(SELF_ROUTING).toEqual(
      expect.arrayContaining(['applovin', 'unity', 'ironsource', 'smadex']),
    )
  })

  it('opens the App Store on an iPhone', () => {
    for (const id of SELF_ROUTING) {
      expect(ctaTarget(id, IPHONE), id).toBe(IOS_URL)
    }
  })

  it('opens Google Play on Android', () => {
    for (const id of SELF_ROUTING) {
      expect(ctaTarget(id, ANDROID), id).toBe(ANDROID_URL)
    }
  })

  it('treats iPadOS (Mac UA + a touch screen) as iOS', () => {
    expect(ctaTarget('applovin', IPADOS)).toBe(IOS_URL)
  })

  it('leaves a real Mac on Google Play', () => {
    expect(ctaTarget('applovin', DESKTOP_MAC)).toBe(ANDROID_URL)
  })

  it('falls back to the other store when the device has none of its own', () => {
    const androidOnly = { ...config, storeUrlIos: undefined }
    expect(ctaTarget('applovin', IPHONE, androidOnly)).toBe(ANDROID_URL)
    const iosOnly = { ...config, storeUrlAndroid: undefined }
    expect(ctaTarget('applovin', ANDROID, iosOnly)).toBe(IOS_URL)
  })

  it('lets an explicit download(url) win over the platform pick', () => {
    const { bridge, dests } = boot('applovin', IPHONE)
    bridge.download?.('https://example.com/promo')
    expect(dests).toEqual(['https://example.com/promo'])
  })

  // In production every MRAID network HAS a container, and the container's own
  // mraid.open(url) is the click-through. That is the path the client hit: a
  // non-empty url overrides whatever store link the network resolved itself.
  it('hands the App Store URL to mraid.open on an iPhone', () => {
    const opened: string[] = []
    const { bridge } = boot('applovin', IPHONE, config, {
      mraid: { open: (u?: string) => opened.push(u ?? '(container default)') },
    })
    bridge.download?.()
    expect(opened).toEqual([IOS_URL])
  })

  // MRAID adapters also override window.install(), because game CTAs written
  // for other packagers call it directly instead of plbx_html.download.
  it('MRAID window.install() picks the same store as download()', () => {
    const opened: string[] = []
    const { win } = boot('applovin', IPHONE, config, {
      mraid: { open: (u?: string) => opened.push(u ?? '(container default)') },
    })
    ;(win.install as () => void)()
    expect(opened).toEqual([IOS_URL])
  })
})
