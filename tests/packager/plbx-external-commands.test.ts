import { describe, it, expect } from 'vitest'
import { genericBridge } from '../../src/packager/network-adapters/base'
import { getAdapter } from '../../src/packager/network-adapters'
import { HtmlBuilder } from '../../src/packager/html-builder'
import { NETWORKS } from '../../src/networks'
import { PackageConfig } from '../../src/types'

/**
 * BUILD side of the plbx_html external-command registry
 * (docs/superpowers/specs/2026-06-25-plbx-html-external-commands-design.md).
 *
 * The registry (`expose` + `external_commands`) lives in buildPlbxBridge(), so
 * every network bridge inherits it. We exercise it through the exported
 * genericBridge() string: eval the ES5 bridge in a minimal sandbox `window`
 * with a stubbed `parent.postMessage`, then drive plbx_html.expose().
 */
describe('plbx_html external-command registry (build side)', () => {
  // Eval the bridge against a fresh sandbox window. `parent` is stubbed so
  // expose()'s postMessage is captured rather than throwing.
  function loadBridge() {
    const posts: any[] = []
    const win: any = {}
    const parent = {
      postMessage: (msg: any, _origin: string) => {
        posts.push(msg)
      },
    }
    // The bridge references `window`, `parent` — provide them as eval-scope vars.

    new Function('window', 'parent', genericBridge())(win, parent)
    return { plbx_html: win.plbx_html, posts }
  }

  it('the bridge string contains the registry members', () => {
    const bridge = genericBridge()
    expect(bridge).toContain('external_commands')
    expect(bridge).toContain('expose: function(name, fn, label)')
  })

  it('expose(name, fn, label) sets plbx_html[name] === fn', () => {
    const { plbx_html } = loadBridge()
    const fn = function () {}
    plbx_html.expose('x', fn, 'X')
    expect(plbx_html.x).toBe(fn)
  })

  it('expose pushes {name,label} to external_commands', () => {
    const { plbx_html } = loadBridge()
    const fn = function () {}
    plbx_html.expose('x', fn, 'X')
    expect(plbx_html.external_commands).toEqual([{ name: 'x', label: 'X' }])
  })

  it('expose posts {type:"plbx:command", name, label} to parent', () => {
    const { plbx_html, posts } = loadBridge()
    plbx_html.expose('x', function () {}, 'X')
    expect(posts).toEqual([{ type: 'plbx:command', name: 'x', label: 'X' }])
  })

  it('expose(name, fn) without a label defaults label to name', () => {
    const { plbx_html, posts } = loadBridge()
    plbx_html.expose('y', function () {})
    expect(plbx_html.external_commands).toEqual([{ name: 'y', label: 'y' }])
    expect(posts).toEqual([{ type: 'plbx:command', name: 'y', label: 'y' }])
  })

  it('expose with a non-function fn is a no-op (no throw, nothing pushed/posted)', () => {
    const { plbx_html, posts } = loadBridge()
    expect(() => plbx_html.expose('bad', 'notfn' as any)).not.toThrow()
    expect(plbx_html.bad).toBeUndefined()
    expect(plbx_html.external_commands).toEqual([])
    expect(posts).toEqual([])
  })

  it('re-exposing the same name updates the handler but does not duplicate the registry/announce', () => {
    const { plbx_html, posts } = loadBridge()
    const first = function () {}
    const second = function () {}
    plbx_html.expose('go', first, 'Go')
    plbx_html.expose('go', second, 'Go again')
    expect(plbx_html.go).toBe(second) // handler updated
    expect(plbx_html.external_commands).toEqual([{ name: 'go', label: 'Go' }]) // no dup, first label wins
    expect(posts).toEqual([{ type: 'plbx:command', name: 'go', label: 'Go' }]) // announced once
  })
})

/**
 * No-drift guard: the registry must reach EVERY network bridge. Two adapters
 * (mintegral, molocoV2) build plbx_html by hand and bypass buildPlbxBridge, so a
 * naive change can silently drop `expose` for them. molocoV2 is excluded here —
 * its bridge ships in a separate payload.js (launcher-payload format), not the
 * main HTML — and is covered by its own adapter edit + build.
 */
const sampleHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Game</title></head>
<body><script src="assets/main.js"></script></body></html>`
const cfg: PackageConfig = {
  storeUrlIos: 'https://apps.apple.com/app/123',
  storeUrlAndroid: 'https://play.google.com/store/apps/details?id=com.test',
  orientation: 'portrait',
}

describe('plbx_html external-command registry — no-drift across networks', () => {
  const ids = Object.keys(NETWORKS).filter((id) => id !== 'molocoV2')
  it.each(ids)('%s build carries expose + external_commands', (id) => {
    const builder = new HtmlBuilder(sampleHtml)
    getAdapter(id).transform(builder, cfg)
    const html = builder.toHtml()
    expect(html).toContain('external_commands')
    expect(html).toContain('expose: function(name, fn, label)')
  })
})
