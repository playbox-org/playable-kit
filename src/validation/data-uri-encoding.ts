/**
 * Text-encoded `data:` URIs — `data:<type>/<subtype>[;k=v…],<payload>` with no
 * `;base64` flag. AppLovin's asset scan rejects the creative on these ("The
 * html file contains assets that are not base64 or base122 encoded").
 *
 * The usual source is Vite: it inlines SVGs under `assetsInlineLimit` through
 * `svgToDataURL()` (URL-encoded, `data:image/svg+xml,%3csvg…`) instead of
 * base64, and no Vite option switches that off. The packager rewrites those to
 * base64 (`base64SvgDataUris`); the validator reports whatever is left
 * (`findTextDataUris`).
 */

// Requires a real MIME type, so minified object keys (`{data:o,format:a}`)
// never match. Params need `=`, so `;base64,` fails the trailing `,`.
const TEXT_DATA_URI_RE = /data:([a-z]+\/[\w.+-]+)((?:;[\w-]+=[\w.-]+)*),/gi

const QUOTES = new Set(['"', "'", '`'])

interface TextDataUri {
  /** Offset of `data:` in the HTML. */
  start: number
  /** Offset just past the closing quote; -1 when not rewritable. */
  end: number
  mime: string
  params: string
  /** A prefix the code completes at runtime — not a shipped asset. */
  runtime: boolean
  /** Raw (still encoded) payload of a plain quoted literal; null otherwise. */
  payload: string | null
}

/**
 * Every text-encoded data URI in `html`. `runtime` marks a prefix the code
 * completes at runtime — empty payload, `${…}` interpolation, an operator
 * after the closing quote. PIXI ships one in every build
 * (`` `data:image/svg+xml;charset=utf8,${…}` ``), so it is not an asset
 * finding. `payload` is set only for a plain quoted literal with no escapes
 * or entities — the only shape a string rewrite can safely touch.
 */
function scanTextDataUris(html: string): TextDataUri[] {
  const out: TextDataUri[] = []
  for (const m of html.matchAll(TEXT_DATA_URI_RE)) {
    const start = m.index
    const bodyStart = start + m[0].length
    const quote = html[start - 1]
    const close = QUOTES.has(quote) ? html.indexOf(quote, bodyStart) : -1
    const hit: TextDataUri = {
      start,
      end: -1,
      mime: m[1],
      params: m[2],
      runtime: false,
      payload: null,
    }
    out.push(hit)
    if (close === -1) {
      // Unquoted, e.g. CSS `url(data:…)`: an asset unless nothing follows.
      hit.runtime = !/^[^\s"'`)<>;]/.test(html.slice(bodyStart, bodyStart + 1))
      continue
    }
    const payload = html.slice(bodyStart, close)
    hit.runtime =
      !payload ||
      payload.includes('${') ||
      /^\s*[+.[]/.test(html.slice(close + 1, close + 8))
    if (hit.runtime || /[\\&\n]/.test(payload)) continue
    hit.end = close + 1
    hit.payload = payload
  }
  return out
}

/**
 * Text-encoded data URIs shipped as assets (runtime-built prefixes excluded),
 * as 60-char snippets for the validator. AppLovin rejects any of these.
 */
export function findTextDataUris(html: string): string[] {
  return scanTextDataUris(html)
    .filter((hit) => !hit.runtime)
    .map((hit) => html.slice(hit.start, hit.start + 60))
}

/**
 * Re-encode every complete SVG text data URI as base64. Only SVG — the one
 * type Vite inlines as text — and only a payload that decodes to a whole
 * `<…>` document; anything else is left as is for the validator to report.
 * Returns the input unchanged (same string) when there is nothing to rewrite.
 */
export function base64SvgDataUris(html: string): string {
  let out = ''
  let last = 0
  for (const hit of scanTextDataUris(html)) {
    if (hit.payload === null || hit.mime.toLowerCase() !== 'image/svg+xml') {
      continue
    }
    let svg: string
    try {
      svg = decodeURIComponent(hit.payload).trim()
    } catch {
      continue // stray `%` — not URL-encoded after all
    }
    if (!svg.startsWith('<') || !svg.endsWith('>')) continue
    const quote = html[hit.end - 1]
    out +=
      html.slice(last, hit.start) +
      `data:${hit.mime}${hit.params};base64,` +
      Buffer.from(svg, 'utf8').toString('base64') +
      quote
    last = hit.end
  }
  return last ? out + html.slice(last) : html
}
