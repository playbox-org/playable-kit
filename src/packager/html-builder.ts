import * as cheerio from 'cheerio'
import type { CheerioAPI } from 'cheerio'
import CleanCSS from 'clean-css'

export class HtmlBuilder {
  private $: cheerio.CheerioAPI

  constructor(html: string) {
    this.$ = cheerio.load(html, {
      decodeEntities: false,
    } as unknown as cheerio.CheerioOptions)
  }

  /** Get all <script> tags with src attribute */
  getScripts(): string[] {
    const scripts: string[] = []
    this.$('script[src]').each((_, el) => {
      const src = this.$(el).attr('src')
      if (src) scripts.push(src)
    })
    return scripts
  }

  /** Get all <link rel="stylesheet"> hrefs */
  getStylesheets(): string[] {
    const links: string[] = []
    this.$('link[rel="stylesheet"]').each((_, el) => {
      const href = this.$(el).attr('href')
      if (href) links.push(href)
    })
    return links
  }

  /** Inject a <script src="..."> tag as the FIRST child of <head> */
  injectHeadScript(src: string): void {
    this.$('head').prepend(`<script src="${src}"></script>\n`)
  }

  /** Inject inline <script> at the end of <body> */
  injectBodyScript(code: string): void {
    this.$('body').append(`<script>${code}</script>\n`)
  }

  /** Inject a <meta> tag into <head> */
  injectMeta(name: string, content: string): void {
    this.$('head').append(`<meta name="${name}" content="${content}">\n`)
  }

  /** Inject a raw HTML comment into <head> (validator-friendly plaintext, super-html parity). */
  injectHeadComment(text: string): void {
    this.$('head').prepend(`<!-- ${text} -->\n`)
  }

  /** Inject a <script src="..."> at the END of <body>. Network SDKs that the
   *  spec wants "at the bottom of body, before the developer's own JS" (TikTok)
   *  go here; the single-file path moves the game bundle after it. */
  injectBodyScriptSrc(src: string): void {
    this.$('body').append(`<script src="${src}"></script>\n`)
  }

  /** Append a <style> block to <head>. */
  injectHeadStyle(css: string): void {
    this.$('head').append(`<style>${css}</style>\n`)
  }

  /** Insert raw HTML as the first child of <body> (splash overlay). */
  prependBody(html: string): void {
    this.$('body').prepend(html)
  }

  /**
   * Local script/stylesheet references. A single-file build has none: every
   * asset is already inlined. `mraid.js` and http(s) URLs are container-served
   * by design and do not count.
   */
  getLocalRefs(): string[] {
    const isLocal = (ref: string) =>
      !!ref && !/^https?:\/\//i.test(ref) && ref !== 'mraid.js'
    const refs: string[] = []
    this.$('script[src]').each((_, el) => {
      const s = this.$(el).attr('src') || ''
      if (isLocal(s)) refs.push(s)
    })
    this.$('link[rel="stylesheet"][href]').each((_, el) => {
      const h = this.$(el).attr('href') || ''
      if (isLocal(h)) refs.push(h)
    })
    return refs
  }

  /**
   * Classic-script rewrite for single-file builds.
   *
   * A `file://` container refuses module scripts ("Do not use crossorigin,
   * type=module…"), so the attributes go. Without `type="module"` an inline
   * script is no longer deferred — it runs where it stands, and a Vite build
   * puts it in <head>, before <body> exists. So the bundle is moved to the
   * very end of <body>: after the DOM it queries and after every bridge
   * script the adapters appended. cheerio's append() MOVES an existing node,
   * so the bundle is not duplicated.
   *
   * Which script IS the bundle: prefer the original `type="module"` script —
   * that is vite-plugin-singlefile's unambiguous marker for the entry bundle,
   * present before any adapter/bridge code is injected. Only when no script
   * carries it (an already-classic single-file build) fall back to the
   * longest inline script — a real bundle dwarfs any bridge/lifecycle script
   * we inject, but a bridge script (e.g. the ~4KB MRAID bridge) CAN outsize a
   * tiny synthetic bundle, so the length heuristic alone is not reliable.
   */
  toClassicBundle(): void {
    let moduleScript: ReturnType<CheerioAPI> | null = null
    let longest: ReturnType<CheerioAPI> | null = null
    let longestLen = -1
    this.$('script').each((_, el) => {
      const $el = this.$(el)
      const isModule = $el.attr('type') === 'module'
      if (isModule) $el.removeAttr('type')
      $el.removeAttr('crossorigin')
      if ($el.attr('src')) return
      if (isModule && !moduleScript) moduleScript = $el
      const len = ($el.html() || '').length
      if (len > longestLen) {
        longestLen = len
        longest = $el
      }
    })
    const bundle = moduleScript || longest
    if (bundle) this.$('body').append(bundle)
  }

  /** Replace a script src with a new src */
  replaceScriptSrc(oldSrc: string, newSrc: string): boolean {
    const script = this.$(`script[src="${oldSrc}"]`)
    if (script.length === 0) return false
    script.attr('src', newSrc)
    return true
  }

  /** Inline a CSS file content into a <style> tag, replacing the <link> */
  inlineCss(href: string, cssContent: string): void {
    const link = this.$(`link[href="${href}"]`)
    if (link.length > 0) {
      link.replaceWith(`<style>${cssContent}</style>`)
    }
  }

  /** Inline a JS file content, replacing the <script src> */
  inlineScript(src: string, jsContent: string): void {
    const script = this.$(`script[src="${src}"]`)
    if (script.length > 0) {
      script.removeAttr('src')
      script.html(jsContent)
    }
  }

  /** Minify all inline <style> blocks using clean-css */
  minifyCss(): void {
    const cleanCss = new CleanCSS({ level: 2 })
    this.$('style').each((_, el) => {
      const style = this.$(el)
      const original = style.html()
      if (original) {
        const minified = cleanCss.minify(original)
        if (minified.styles) {
          style.html(minified.styles)
        }
      }
    })
  }

  /** Set the <title> */
  setTitle(title: string): void {
    this.$('title').text(title)
  }

  /** Get the final HTML string */
  toHtml(): string {
    return this.$.html()
  }
}
