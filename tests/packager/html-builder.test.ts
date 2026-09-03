import { describe, it, expect, beforeAll } from 'vitest'
import { HtmlBuilder } from '../../src/packager/html-builder'
import { readFileSync } from 'fs'
import { join } from 'path'

const SAMPLE_HTML_PATH = join(__dirname, '../fixtures/sample-build/index.html')
let sampleHtml: string

beforeAll(() => {
  sampleHtml = readFileSync(SAMPLE_HTML_PATH, 'utf-8')
})

describe('HtmlBuilder', () => {
  it('should parse HTML and find scripts', () => {
    const builder = new HtmlBuilder(sampleHtml)
    const scripts = builder.getScripts()
    expect(scripts).toContain('cocos-js/cc.js')
    expect(scripts).toContain('assets/main.js')
  })

  it('should find stylesheets', () => {
    const builder = new HtmlBuilder(sampleHtml)
    const sheets = builder.getStylesheets()
    expect(sheets).toContain('style.css')
  })

  it('should inject script tag into head', () => {
    const builder = new HtmlBuilder(sampleHtml)
    builder.injectHeadScript('mraid.js')
    const html = builder.toHtml()
    expect(html).toContain('<script src="mraid.js"></script>')
    // Should be in <head>, before other content
    const headContent = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] || ''
    expect(headContent).toContain('mraid.js')
  })

  it('should inject meta tag', () => {
    const builder = new HtmlBuilder(sampleHtml)
    builder.injectMeta('ad.size', 'width=320,height=480')
    const html = builder.toHtml()
    expect(html).toContain('name="ad.size"')
    expect(html).toContain('content="width=320,height=480"')
  })

  it('should inject inline script into body', () => {
    const builder = new HtmlBuilder(sampleHtml)
    builder.injectBodyScript('window.gameReady = true;')
    const html = builder.toHtml()
    expect(html).toContain('window.gameReady = true;')
  })

  it('should replace script src', () => {
    const builder = new HtmlBuilder(sampleHtml)
    const replaced = builder.replaceScriptSrc('assets/main.js', 'creative.js')
    expect(replaced).toBe(true)
    const html = builder.toHtml()
    expect(html).toContain('creative.js')
    expect(html).not.toContain('assets/main.js')
  })

  it('should return false when replacing non-existent script', () => {
    const builder = new HtmlBuilder(sampleHtml)
    const replaced = builder.replaceScriptSrc('nonexistent.js', 'new.js')
    expect(replaced).toBe(false)
  })

  it('should inline CSS content replacing link tag', () => {
    const builder = new HtmlBuilder(sampleHtml)
    builder.inlineCss('style.css', '.game { color: red; }')
    const html = builder.toHtml()
    expect(html).not.toContain('href="style.css"')
    expect(html).toContain('.game { color: red; }')
  })

  it('should inline JS content replacing script src', () => {
    const builder = new HtmlBuilder(sampleHtml)
    builder.inlineScript('assets/main.js', 'var game = {};')
    const html = builder.toHtml()
    expect(html).not.toContain('src="assets/main.js"')
    expect(html).toContain('var game = {};')
  })

  it('should minify inline CSS', () => {
    const builder = new HtmlBuilder(sampleHtml)
    const beforeHtml = builder.toHtml()
    builder.minifyCss()
    const afterHtml = builder.toHtml()
    // Minified should be shorter or equal
    expect(afterHtml.length).toBeLessThanOrEqual(beforeHtml.length)
  })

  it('should set title', () => {
    const builder = new HtmlBuilder(sampleHtml)
    builder.setTitle('My Playable Ad')
    expect(builder.toHtml()).toContain('<title>My Playable Ad</title>')
  })

  it('should inject head comment with store URL inside head', () => {
    const builder = new HtmlBuilder(sampleHtml)
    const url = 'https://play.google.com/store/apps/details?id=com.test'
    builder.injectHeadComment(url)
    const html = builder.toHtml()
    expect(html).toContain(`<!-- ${url} -->`)
    // Comment should land inside <head>
    const headContent = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] || ''
    expect(headContent).toContain(url)
  })

  it('should NOT HTML-escape special chars in head comment', () => {
    const builder = new HtmlBuilder(sampleHtml)
    const url = 'https://play.google.com/store/apps/details?id=com.test'
    builder.injectHeadComment(url)
    const html = builder.toHtml()
    const headContent = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] || ''
    // Special chars must survive verbatim, not entity-escaped
    expect(headContent).toContain('?id=com.test')
    expect(headContent).not.toContain('&#63;')
    expect(headContent).not.toContain('&quest;')
    expect(headContent).not.toContain('&#61;')
  })

  describe('single-file helpers', () => {
    const vite =
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<script type="module" crossorigin>(function(){window.__bundle=1})();</script>' +
      '<style>body{margin:0}</style></head>' +
      '<body><canvas id="game"></canvas></body></html>'

    it('injectBodyScriptSrc appends a src script at the end of body', () => {
      const b = new HtmlBuilder(vite)
      b.injectBodyScriptSrc('https://cdn.example/sdk.js')
      const html = b.toHtml()
      const at = html.indexOf('<script src="https://cdn.example/sdk.js"></script>')
      expect(at).toBeGreaterThan(html.indexOf('<canvas'))
      expect(at).toBeLessThan(html.indexOf('</body>'))
    })

    it('injectHeadStyle and prependBody land where the splash needs them', () => {
      const b = new HtmlBuilder(vite)
      b.injectHeadStyle('#s{color:red}')
      b.prependBody('<div id="s">splash</div>')
      const html = b.toHtml()
      expect(html.indexOf('<style>#s{color:red}</style>')).toBeLessThan(html.indexOf('</head>'))
      expect(html.indexOf('<div id="s">')).toBeLessThan(html.indexOf('<canvas'))
    })

    it('getLocalRefs ignores http(s) and mraid.js', () => {
      const b = new HtmlBuilder(
        '<html><head><script src="mraid.js"></script>' +
          '<script src="https://x/y.js"></script>' +
          '<link rel="stylesheet" href="style.css"></head>' +
          '<body><script src="game.js"></script></body></html>',
      )
      expect(b.getLocalRefs()).toEqual(['game.js', 'style.css'])
      expect(new HtmlBuilder(vite).getLocalRefs()).toEqual([])
    })

    it('toClassicBundle strips module attrs and moves the bundle after body scripts', () => {
      const b = new HtmlBuilder(vite)
      b.injectBodyScript('window.plbx_html = {};')
      b.toClassicBundle()
      const html = b.toHtml()
      expect(html).not.toContain('type="module"')
      expect(html).not.toContain('crossorigin')
      const bridgeAt = html.indexOf('window.plbx_html = {}')
      const bundleAt = html.indexOf('window.__bundle=1')
      expect(bridgeAt).toBeGreaterThan(-1)
      expect(bundleAt).toBeGreaterThan(bridgeAt)
      expect(bundleAt).toBeLessThan(html.indexOf('</body>'))
      // moved, not copied
      expect(html.split('window.__bundle=1').length).toBe(2)
    })

    it('toClassicBundle prefers the type="module" script over a longer plain inline script', () => {
      // A tiny module bundle (the real bundle) alongside a much larger plain
      // inline script injected afterwards (simulating an adapter-injected
      // bridge, e.g. the ~4KB MRAID bridge outsizing a small synthetic build).
      // The length heuristic alone would wrongly pick the bridge; the module
      // marker must win.
      const b = new HtmlBuilder(vite)
      const bigBridge = `window.plbx_html = {}; /* ${'x'.repeat(2000)} */`
      b.injectBodyScript(bigBridge)
      expect(bigBridge.length).toBeGreaterThan('(function(){window.__bundle=1})();'.length)
      b.toClassicBundle()
      const html = b.toHtml()
      expect(html).not.toContain('type="module"')
      const bridgeAt = html.indexOf('window.plbx_html = {}')
      const bundleAt = html.indexOf('window.__bundle=1')
      expect(bridgeAt).toBeGreaterThan(-1)
      // The module script (the bundle) was moved after the larger bridge script.
      expect(bundleAt).toBeGreaterThan(bridgeAt)
      expect(bundleAt).toBeLessThan(html.indexOf('</body>'))
      // The larger plain script stayed exactly where it was injected — NOT moved.
      expect(html.split('window.plbx_html = {}').length).toBe(2)
      expect(html.split('window.__bundle=1').length).toBe(2)
    })
  })
})
