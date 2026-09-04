import { parseArgs } from 'node:util'
import { resolve, basename } from 'node:path'
import { packageForNetworks } from './packager/packager'
import { NETWORKS } from './networks'
import { KIT_VERSION } from './version'
import type { Orientation, PackageConfig } from './types'

const USAGE = `playable-kit ${KIT_VERSION}

  playable-kit package [--build dist] [--out dist-networks] [--networks all|a,b,c]
                       [--name "Asset Title"] [--orientation auto|portrait|landscape]
                       [--android URL] [--ios URL] [--input auto|loader|single-file] [--splash]
                       [--splash-logo <path>]

Packages a web build (a Vite single-file index.html, a Cocos web-mobile dir, or
any index.html + assets) for every ad network. Output: <out>/<network>/<name>_<network>.<html|zip>.
The loading splash is off by default; pass --splash to show it (--splash-logo
swaps the PLBX mark for a custom logo, with --splash).`

const mb = (b: number) => `${(b / 1e6).toFixed(2)} MB`

export async function main(
  argv: string[],
  log: (line: string) => void = (l) => console.log(l),
): Promise<number> {
  const [cmd, ...rest] = argv
  if (cmd !== 'package') {
    log(USAGE)
    return 1
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      build: { type: 'string', default: 'dist' },
      out: { type: 'string', default: 'dist-networks' },
      networks: { type: 'string', default: 'all' },
      name: { type: 'string' },
      orientation: { type: 'string', default: 'auto' },
      android: { type: 'string' },
      ios: { type: 'string' },
      input: { type: 'string', default: 'auto' },
      splash: { type: 'boolean', default: false },
      'splash-logo': { type: 'string' },
    },
  })

  const buildDir = resolve(values.build!)
  const outputDir = resolve(values.out!)
  const networks =
    values.networks === 'all'
      ? Object.keys(NETWORKS)
      : values.networks!.split(',').map((s) => s.trim()).filter(Boolean)
  for (const n of networks) {
    if (!NETWORKS[n]) {
      log(`Unknown network "${n}". One of: ${Object.keys(NETWORKS).join(', ')}`)
      return 1
    }
  }
  const name = values.name || basename(buildDir)
  // Sanitized once here (matches the packager's own sanitizeFileBase pass) so
  // the file on disk is predictable even before resolveInnerHtmlName's
  // Mintegral-specific re-sanitization runs.
  const sanitizedName = name.replace(/[^A-Za-z0-9._-]+/g, '_')
  const config: PackageConfig = {
    orientation: values.orientation as Orientation,
    storeUrlAndroid: values.android,
    storeUrlIos: values.ios,
    input: values.input as PackageConfig['input'],
    showSplash: !!values.splash,
    customSplashLogo: values['splash-logo']
      ? resolve(values['splash-logo'])
      : undefined,
  }

  const errors: string[] = []
  const result = await packageForNetworks({
    buildDir,
    outputDir,
    networks,
    config,
    // resolveTemplate lowercases any all-lowercase token (its casing
    // convention: {name} → lowercase, {Name} → Capitalized, only the exact
    // key match with NO normalized-key collision passes a value through
    // unchanged — see template-resolver.ts). {Name}/`Name` is the only pairing
    // that survives resolveTemplate byte-for-byte, so the on-disk filename
    // keeps the user's exact casing ("My Game" → "My_Game_applovin.html")
    // instead of being forced to "my_game_applovin.html".
    templateVariables: { assetTitle: name, Name: sanitizedName },
    outputTemplate: '{networkId}/{Name}_{networkId}.{ext}',
    onProgress: (id, status, message) => {
      if (status === 'error') errors.push(`${id}: ${message}`)
      else if (message) log(`  ${id}: ${message}`)
    },
  })

  log('')
  log('  network            upload    limit    file  (zip entry)')
  log('  ' + '-'.repeat(78))
  let anyOver = false
  for (const r of result.results) {
    if (!r.outputPath) continue
    const over = !r.withinLimit
    if (over) anyOver = true
    const entry = r.outputPath.endsWith('.zip') ? innerEntryLabel(r.networkId, r.outputPath) : ''
    log(
      `  ${r.networkId.padEnd(18)} ${(mb(r.outputSize) + (over ? ' !!' : '')).padEnd(9)} ` +
        `${mb(r.maxSize).padEnd(8)} ${basename(r.outputPath)}${entry}`,
    )
  }
  if (anyOver) log("\n  !! over that network's limit — it will be refused on upload")
  for (const e of errors) log(`  ERROR ${e}`)
  log(`\n  ${outputDir}\n`)
  return errors.length ? 1 : 0
}

/** "(inner.html)" for the table — the inner name mirrors the archive base for
 *  htmlMatchesZipName networks, else the literal / index.html. */
function innerEntryLabel(resultId: string, zipPath: string): string {
  // Result ids carry suffixes for variants ("google-portrait", "facebook-zip").
  const id = Object.keys(NETWORKS).find((n) => resultId === n || resultId.startsWith(`${n}-`))
  const net = id ? NETWORKS[id] : undefined
  const inner = net?.htmlFileName
    ? net.htmlFileName
    : net?.htmlMatchesZipName
      ? basename(zipPath, '.zip') + '.html'
      : 'index.html'
  return `  (${inner})`
}

/* c8 ignore next 3 */
if (typeof require !== 'undefined' && (require as any).main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
