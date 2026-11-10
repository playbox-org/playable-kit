import { readdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { minify_sync } from 'terser'
import JavaScriptObfuscator from 'javascript-obfuscator'
import * as cheerio from 'cheerio'
import { rewriteCocosJs, shouldRewriteCocosJs } from './cocos-js-rewriter'

export function protectJavaScript(source: string, module = false): string {
  const licenses = new Set<string>()
  const { code } = minify_sync(source, {
    module,
    compress: true,
    mangle: true,
    format: {
      comments: (_node, comment) => {
        if (/^!|@license|@preserve|@cc_on/i.test(comment.value)) licenses.add(comment.value)
        return false
      },
      inline_script: true,
    },
  })
  if (!code) return ''
  const protectedCode = JavaScriptObfuscator.obfuscate(code, {
    target: 'browser-no-eval',
    compact: true,
    seed: 603,
    identifierNamesGenerator: 'mangled',
    renameGlobals: false,
    renameProperties: false,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    selfDefending: false,
    simplify: false,
    stringArray: false,
    unicodeEscapeSequence: true,
    // Keep assets compact and network scanners able to find store URLs.
    reservedStrings: ['^data:', '^https?://'],
    sourceMap: false,
  }).getObfuscatedCode()
  return ([...licenses].map(text => `/*${text}*/\n`).join('') + protectedCode)
    .replace(/<\/script/gi, '<\\/script')
}

export function protectPlayableHtml(html: string, deferBoot = false): string {
  const $ = cheerio.load(html)
  $('script:not([src])').each((_, el) => {
    const script = $(el)
    const type = (script.attr('type') || '').trim().toLowerCase()
    if (type && !['module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type)) return
    const source = script.text()
    const boot = deferBoot && /System\.import/.test(source)
      ? `window.__plbx_boot = function() { ${source}\n};`
      : source
    script.text(protectJavaScript(boot, type === 'module'))
  })
  return $.html()
}

export function createScriptProtector() {
  const cache = new Map<string, string>()
  return (path: string, content: Buffer, selfContained: boolean) => {
    if (!/\.[cm]?js$/i.test(path)) return null
    const key = `${selfContained}:${path}`
    if (!cache.has(key)) {
      const source = shouldRewriteCocosJs(path)
        ? rewriteCocosJs(content.toString('utf8'), { selfContained })
        : content.toString('utf8')
      cache.set(key, protectJavaScript(source, /\.mjs$/i.test(path)))
    }
    return cache.get(key)!
  }
}

export function forbiddenBuildStrings(dir: string, forbidden: string[]): string[] {
  const found = new Set<string>()
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      for (const match of forbiddenBuildStrings(path, forbidden)) found.add(match)
    } else if (/\.(?:[cm]?js|html)$/i.test(entry.name)) {
      const source = readFileSync(path, 'utf8')
      for (const match of forbidden) if (source.includes(match)) found.add(match)
    }
  }
  return [...found]
}

export function protectBuildDirectory(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) protectBuildDirectory(path)
    else if (/\.map$/i.test(entry.name)) rmSync(path)
    else if (/\.(?:[cm]?js|html)$/i.test(entry.name)) {
      const source = readFileSync(path, 'utf8')
      writeFileSync(path, /\.html$/i.test(entry.name)
        ? protectPlayableHtml(source)
        : protectJavaScript(source, /\.mjs$/i.test(entry.name)))
    }
  }
}
