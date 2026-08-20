import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import JSZip from 'jszip'
import { basename, join } from 'path'
import { packageForNetworks } from '../../src/packager/packager'
import {
  extractLunaUsage,
  validateLunaEvents,
  LUNA_EVENT_CAPS,
  LUNA_STANDARD_EVENTS,
} from '../../src/validation/luna-events'

let tmpDir: string

function mkTmp(): string {
  tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'plbx-luna-'))
  return tmpDir
}

function write(dir: string, name: string, content: string): void {
  const full = join(dir, name)
  fs.mkdirSync(join(full, '..'), { recursive: true })
  fs.writeFileSync(full, content, 'utf8')
}

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

describe('extractLunaUsage', () => {
  it('counts literal logCustomEvent call sites per name', () => {
    const dir = mkTmp()
    write(
      dir,
      'main.js',
      "pi.logCustomEvent('level_1', 1); pi.logCustomEvent('level_1', 2); pi.logCustomEvent(\"level_2\", 1);",
    )
    const usage = extractLunaUsage(dir)
    expect(usage.events).toEqual([
      { name: 'level_1', count: 2, valueOk: true },
      { name: 'level_2', count: 1, valueOk: true },
    ])
    expect(usage.dynamicNames).toBe(0)
    expect(usage.redefinesSdk).toBe(false)
    expect(usage.source).toBe('static')
  })

  it('marks a missing or non-integer value as valueOk: false', () => {
    const dir = mkTmp()
    write(dir, 'main.js', "pi.logCustomEvent('a'); pi.logCustomEvent('b', 'oops');")
    const usage = extractLunaUsage(dir)
    expect(usage.events).toEqual([
      { name: 'a', count: 1, valueOk: false },
      { name: 'b', count: 1, valueOk: false },
    ])
  })

  it('counts runtime-built names separately instead of guessing them', () => {
    const dir = mkTmp()
    write(dir, 'main.js', "pi.logCustomEvent('playtime_' + n + 's', 1); pi.logCustomEvent(name, 1);")
    const usage = extractLunaUsage(dir)
    expect(usage.events).toEqual([])
    expect(usage.dynamicNames).toBe(2)
  })

  it('detects an assignment to the SDK globals but not a defensive guard', () => {
    const dir = mkTmp()
    write(dir, 'guard.js', 'if (window.pi === undefined) {} if (typeof Luna == "undefined") {}')
    expect(extractLunaUsage(dir).redefinesSdk).toBe(false)
    const dir2 = mkTmp()
    write(dir2, 'bad.js', 'window.pi = { logCustomEvent: function () {} };')
    expect(extractLunaUsage(dir2).redefinesSdk).toBe(true)
  })

  it('skips unreadable directories and non-source files', () => {
    const dir = mkTmp()
    write(dir, 'assets/sprite.png', "pi.logCustomEvent('nope', 1)")
    write(dir, 'node_modules/dep/index.js', "pi.logCustomEvent('dep', 1)")
    expect(extractLunaUsage(dir).events).toEqual([])
    expect(extractLunaUsage(join(dir, 'missing'))).toEqual({
      source: 'static',
      events: [],
      dynamicNames: 0,
      redefinesSdk: false,
    })
  })
})

describe('LUNA_STANDARD_EVENTS', () => {
  it('lists the events Luna injects at export time', () => {
    expect(LUNA_STANDARD_EVENTS).toContain('adImpression')
    expect(LUNA_STANDARD_EVENTS).toContain('adClick')
  })
})

const byId = (checks: any[], id: string) => checks.find((c) => c.id === id)

describe('validateLunaEvents', () => {
  it('is silent for a project with no custom events', () => {
    expect(validateLunaEvents({ source: 'static', events: [] })).toEqual([])
  })

  it('flags a name over the 32-per-name cap', () => {
    const checks = validateLunaEvents({
      source: 'runtime',
      events: [{ name: 'tap', count: LUNA_EVENT_CAPS.perName + 1 }],
    })
    expect(byId(checks, 'caps_per_name').ok).toBe(false)
    expect(byId(checks, 'caps_per_name').level).toBe('error')
  })

  it('flags the 256-per-session cap across names', () => {
    const events = Array.from({ length: 9 }, (_, i) => ({ name: 'e' + i, count: 30 }))
    expect(byId(validateLunaEvents({ source: 'runtime', events }), 'caps_session').ok).toBe(false)
  })

  it('warns about events fired before startGame', () => {
    const checks = validateLunaEvents({
      source: 'runtime',
      events: [{ name: 'a', count: 1, beforeStart: true }],
    })
    expect(byId(checks, 'events_before_start')).toMatchObject({ ok: false, level: 'warn' })
  })

  it('rejects empty and whitespace names', () => {
    expect(byId(validateLunaEvents({ source: 'static', events: [{ name: 'play time', count: 1 }] }), 'name_valid').ok).toBe(false)
  })

  it('warns when a string-named event carries no integer value', () => {
    expect(byId(validateLunaEvents({
        source: 'static',
        events: [{ name: 'a', count: 1, valueOk: false }],
      }), 'value_int').ok).toBe(false)
  })

  it('fails a CTA that bypassed InstallFullGame', () => {
    const checks = validateLunaEvents({
      source: 'runtime',
      events: [{ name: 'a', count: 1 }],
      ctaViaInstall: false,
    })
    expect(byId(checks, 'cta_via_install')).toMatchObject({ ok: false, level: 'error' })
  })

  it('fails a creative that redefines the Luna SDK globals', () => {
    expect(byId(validateLunaEvents({ source: 'static', events: [], redefinesSdk: true }), 'no_sdk_redefine').ok).toBe(false)
  })

  it('reports runtime-built names as info, not failure', () => {
    const c = byId(validateLunaEvents({
        source: 'static',
        events: [{ name: 'a', count: 1 }],
        dynamicNames: 2,
      }), 'dynamic_names')
    expect(c.level).toBe('info')
  })
})

// FINDING 6 regression. REDEFINE_RE used to carry a bare `Luna =` alternative,
// and no_sdk_redefine is the ONE check that also fires on the empty-usage path:
// any build whose sources happened to contain a local binding named `Luna`
// (bundled dependency, minifier output) got an ERROR row — on a project with no
// custom events at all.
describe('SDK redefinition detection', () => {
  it('ignores a local binding named Luna, flags the global write', () => {
    const local = mkTmp()
    write(
      local,
      'vendor.js',
      'var Luna = require("luna-sdk"), pi = 3;\nfunction f(){ let Luna = {}; return Luna }',
    )
    expect(extractLunaUsage(local).redefinesSdk).toBe(false)
    expect(validateLunaEvents(extractLunaUsage(local))).toEqual([])

    const global_ = mkTmp()
    write(global_, 'bad.js', 'window.Luna = { Unity: {} };')
    expect(extractLunaUsage(global_).redefinesSdk).toBe(true)
  })

  it('flags globalThis/self writes to either SDK global', () => {
    for (const src of [
      'globalThis.Luna = {}',
      'self.pi = function () {}',
      'window.pi={logCustomEvent:function(){}}',
    ]) {
      const dir = mkTmp()
      write(dir, 'x.js', src)
      expect(extractLunaUsage(dir).redefinesSdk).toBe(true)
    }
  })
})

// FINDING 5 regression. `count` from a static scan is CALL SITES, not fires, so
// a caps verdict computed from it is meaningless in both directions.
describe('caps rows are gated on runtime provenance', () => {
  it('emits no caps rows for a static scan', () => {
    // A minified bundle repeating one literal 33× is not 33 fires.
    const checks = validateLunaEvents({
      source: 'static',
      events: [{ name: 'tap', count: LUNA_EVENT_CAPS.perName + 1 }],
    })
    expect(checks.map((c) => c.id)).not.toContain('caps_per_name')
    expect(checks.map((c) => c.id)).not.toContain('caps_session')
    // …and the static rules still run.
    expect(byId(checks, 'name_valid')).toBeDefined()
  })

  it('emits no session-cap row for a static scan over the total', () => {
    const events = Array.from({ length: 9 }, (_, i) => ({
      name: 'e' + i,
      count: 30,
    }))
    expect(
      validateLunaEvents({ source: 'static', events }).map((c) => c.id),
    ).not.toContain('caps_session')
  })

  it('still emits both caps rows for runtime counts', () => {
    const checks = validateLunaEvents({
      source: 'runtime',
      events: [{ name: 'tap', count: 2 }],
    })
    expect(byId(checks, 'caps_per_name')).toMatchObject({ ok: true })
    expect(byId(checks, 'caps_session')).toMatchObject({ ok: true })
  })

  it('does not green-light a loop the static scan cannot see', () => {
    // The failure this gates: one call site inside a 100-iteration loop. The
    // static scan reports count 1 → the old code shipped a PASSED caps row for
    // a creative Luna truncates at 32.
    const dir = mkTmp()
    write(dir, 'main.js', "for (var i=0;i<100;i++) pi.logCustomEvent('tick', i);")
    const checks = validateLunaEvents(extractLunaUsage(dir))
    expect(checks.some((c) => c.id.startsWith('caps_'))).toBe(false)
  })
})

/**
 * FINDING 7 + 8 regression. These are packaging-side assertions, but they live
 * here because what they guard is this module being REACHABLE at all: before
 * the fix extractLunaUsage/validateLunaEvents were exported from the barrel and
 * called from nowhere in src/, so packaging for luna emitted zero analytics
 * warnings and every static rule in spec §6 shipped dead.
 * (tests/packager/* is owned by a parallel workstream; keeping these next to
 * the module under test avoids a collision.)
 */
describe('luna packaging surfaces the static event advisories', () => {
  const packLuna = async (
    src: Record<string, string>,
    opts: { dirName?: string; templateVariables?: Record<string, string> } = {},
  ) => {
    const root = mkTmp()
    // The build folder name is deliberately internal-looking: it is exactly the
    // value that used to leak into the shipped luna.json as applicationName.
    const build = join(root, opts.dirName ?? 'lunacheck')
    write(
      build,
      'index.html',
      '<!DOCTYPE html><html><head></head><body><script src="main.js"></script></body></html>',
    )
    for (const [name, content] of Object.entries(src)) write(build, name, content)
    const out = join(root, 'out')
    const result = await packageForNetworks({
      buildDir: build,
      outputDir: out,
      networks: ['luna'],
      config: { orientation: 'portrait' },
      templateVariables: opts.templateVariables,
    })
    const zip = await JSZip.loadAsync(
      fs.readFileSync(result.results[0].outputPath),
    )
    return {
      build,
      warnings: result.results[0].warnings ?? [],
      luna: JSON.parse(await zip.file('luna.json')!.async('string')),
      playground: JSON.parse(await zip.file('playground.json')!.async('string')),
    }
  }

  it('warns on an unusable event name found in the build source', async () => {
    const { warnings } = await packLuna({
      'main.js': "pi.logCustomEvent('level up', 1);",
    })
    expect(warnings.some((w) => /^Luna events —/.test(w))).toBe(true)
    expect(warnings.join('\n')).toContain('level up')
  })

  it('never warns about the runtime-only caps at package time', async () => {
    // 33 call sites is not 33 fires — see LunaEventUsage.source.
    const { warnings } = await packLuna({
      'main.js': Array.from(
        { length: LUNA_EVENT_CAPS.perName + 1 },
        () => "pi.logCustomEvent('tap', 1);",
      ).join('\n'),
    })
    expect(warnings.join('\n')).not.toMatch(/fires of one name|in the session/)
  })

  it('stays quiet for a build with no custom events', async () => {
    const { warnings } = await packLuna({ 'main.js': 'console.log("game");' })
    expect(warnings.filter((w) => w.startsWith('Luna events'))).toEqual([])
  })

  it('never publishes the build directory name as applicationName', async () => {
    const { build, luna } = await packLuna({ 'main.js': 'void 0;' })
    expect(luna.unity.packages.default.applicationName).not.toBe(basename(build))
    expect(luna.unity.packages.default.applicationName).not.toContain('lunacheck')
  })

  it('uses the asset title when the caller supplies one', async () => {
    const { luna, playground } = await packLuna(
      { 'main.js': 'void 0;' },
      { templateVariables: { assetTitle: 'Roadside Rescue' } },
    )
    expect(luna.unity.packages.default.applicationName).toBe('Roadside Rescue')
    expect(playground.title).toBe('Roadside Rescue')
  })
})

/**
 * FINDING C regression. The scanner only knew `pi.logCustomEvent(...)`, but the
 * integration path this kit SHIPS is `window.plbx_html.log_event(name, value)`
 * (spec §3.5) — the packager injects that channel and routes it to
 * pi.logCustomEvent itself. A game written against the plbx/super_html channel
 * never types "logCustomEvent", so the scan reported "no events" and every
 * static rule in spec §6 silently no-opped on exactly the intended integration.
 */
describe('extractLunaUsage understands the plbx_html channel too', () => {
  it('counts plbx_html.log_event call sites like logCustomEvent ones', () => {
    const dir = mkTmp()
    write(
      dir,
      'main.js',
      "window.plbx_html.log_event('level_1', 1); plbx_html.log_event('level_1', 2); pi.logCustomEvent('level_1', 3);",
    )
    expect(extractLunaUsage(dir).events).toEqual([
      { name: 'level_1', count: 3, valueOk: true },
    ])
  })

  it('applies the value check to log_event calls', () => {
    // A non-numeric literal still warns in the channel spelling: the bridge
    // substitutes 1, so the number the author asked for is not the number Luna
    // records. (A MISSING value is a different case — see FINDING 1 below.)
    const dir = mkTmp()
    write(dir, 'main.js', "plbx_html.log_event('b', 'oops');")
    expect(extractLunaUsage(dir).events).toEqual([
      { name: 'b', count: 1, valueOk: false },
    ])
  })

  it('counts runtime-built log_event names as dynamic', () => {
    const dir = mkTmp()
    write(dir, 'main.js', "plbx_html.log_event('playtime_' + n + 's', 1);")
    const usage = extractLunaUsage(dir)
    expect(usage.events).toEqual([])
    expect(usage.dynamicNames).toBe(1)
  })

  it('does not mistake the injected channel DEFINITION for a call site', () => {
    // The bridge itself is `window.plbx_html.log_event = function(name, value)`
    // — an assignment, not a call. A scanner that matched it would report a
    // phantom dynamic event for every build.
    const dir = mkTmp()
    write(
      dir,
      'bridge.js',
      'window.plbx_html.log_event = function(name, value) { pi.logCustomEvent(name, value); };',
    )
    const usage = extractLunaUsage(dir)
    expect(usage.events).toEqual([])
    expect(usage.dynamicNames).toBe(1) // the pi.logCustomEvent(name, value) forward
  })

  it('surfaces a bad name authored through the plbx channel at package time', async () => {
    // End of the same wire: the packaging gate must warn on it, not stay mute.
    const root = mkTmp()
    const build = join(root, 'web-mobile')
    write(
      build,
      'index.html',
      '<!DOCTYPE html><html><head></head><body><script src="main.js"></script></body></html>',
    )
    write(build, 'main.js', "window.plbx_html.log_event('level up', 1);")
    const result = await packageForNetworks({
      buildDir: build,
      outputDir: join(root, 'out'),
      networks: ['luna'],
      config: { orientation: 'portrait' },
    })
    expect((result.results[0].warnings ?? []).join('\n')).toContain('level up')
  }, 60_000)
})

/**
 * FINDING B regression. `config.appName || 'Playable'` fed BOTH manifests, so
 * the fabricated name the packager fix had just removed came back through the
 * adapter: an unnamed creative shipped `"applicationName": "Playable"` to the
 * client's Playworks account. Spec §2: applicationName is
 * `assetTitle || projectName || ''` — an empty string is Luna's documented
 * "unknown" — and only playground.json's human-facing title may fall back.
 */
describe('applicationName and the playground title are separate values', () => {
  it('ships an empty applicationName and a display-only title fallback', async () => {
    const root = mkTmp()
    const build = join(root, 'web-mobile')
    write(
      build,
      'index.html',
      '<!DOCTYPE html><html><head></head><body></body></html>',
    )
    const result = await packageForNetworks({
      buildDir: build,
      outputDir: join(root, 'out'),
      networks: ['luna'],
      // Nothing names the creative: no appName, no assetTitle, no projectName.
      config: { orientation: 'portrait' },
    })
    const zip = await JSZip.loadAsync(
      fs.readFileSync(result.results[0].outputPath),
    )
    const luna = JSON.parse(await zip.file('luna.json')!.async('string'))
    const playground = JSON.parse(
      await zip.file('playground.json')!.async('string'),
    )
    expect(luna.unity.packages.default.applicationName).toBe('')
    expect(playground.title).toBe('Playable')
  }, 60_000)
})

/**
 * FINDING 1 regression. The value rule read only the ARGUMENTS, never the call
 * SHAPE, so a value-less call warned in both spellings with the same "a missing
 * one is a silent drop" detail. That is true for `pi.logCustomEvent('x')`, which
 * reaches Luna as-is — and FALSE for `plbx_html.log_event('x')`, because the
 * bridge we inject defaults the value itself
 * (`var v = (typeof value === 'number' && isFinite(value)) ? (value | 0) : 1;`).
 * Packaging a game that uses our own sanctioned channel correctly produced a
 * spurious warning, so the extractor has to keep the shape per call site.
 */
describe('the value rule follows the call shape, not just the name', () => {
  it('accepts a value-less log_event call — the bridge defaults it to 1', () => {
    const dir = mkTmp()
    write(dir, 'main.js', "window.plbx_html.log_event('level_1'); plbx_html.log_event('level_2');")
    expect(extractLunaUsage(dir).events).toEqual([
      { name: 'level_1', count: 1, valueOk: true },
      { name: 'level_2', count: 1, valueOk: true },
    ])
  })

  it('still flags a value-less logCustomEvent call — Luna drops it', () => {
    const dir = mkTmp()
    write(dir, 'main.js', "pi.logCustomEvent('level_1');")
    expect(extractLunaUsage(dir).events).toEqual([
      { name: 'level_1', count: 1, valueOk: false },
    ])
  })

  it('accepts an integer value in either spelling', () => {
    const dir = mkTmp()
    write(dir, 'main.js', "pi.logCustomEvent('a', 1); plbx_html.log_event('b', 2);")
    expect(extractLunaUsage(dir).events).toEqual([
      { name: 'a', count: 1, valueOk: true },
      { name: 'b', count: 1, valueOk: true },
    ])
  })

  it('flags a non-numeric value in either spelling', () => {
    const dir = mkTmp()
    write(dir, 'main.js', "pi.logCustomEvent('a', 'x'); plbx_html.log_event('b', 'x');")
    expect(extractLunaUsage(dir).events).toEqual([
      { name: 'a', count: 1, valueOk: false },
      { name: 'b', count: 1, valueOk: false },
    ])
  })

  it('loses valueOk for a name only its logCustomEvent site got wrong', () => {
    const dir = mkTmp()
    write(dir, 'main.js', "plbx_html.log_event('a'); pi.logCustomEvent('a');")
    expect(extractLunaUsage(dir).events).toEqual([
      { name: 'a', count: 2, valueOk: false },
    ])
  })

  it('does not warn at package time about a value-less plbx_html.log_event', async () => {
    const root = mkTmp()
    const build = join(root, 'web-mobile')
    write(
      build,
      'index.html',
      '<!DOCTYPE html><html><head></head><body><script src="main.js"></script></body></html>',
    )
    write(build, 'main.js', "window.plbx_html.log_event('level_1');")
    const result = await packageForNetworks({
      buildDir: build,
      outputDir: join(root, 'out'),
      networks: ['luna'],
      config: { orientation: 'portrait' },
    })
    expect((result.results[0].warnings ?? []).join('\n')).not.toMatch(
      /integer parameter/,
    )
  }, 60_000)
})

/**
 * FINDING 2 regression. CALL_RE had no identifier boundary, so ANY identifier
 * ENDING in one of the two spellings was scanned as a Luna analytics call:
 * `analytics.catalog_event('shop_open', 2)` extracted a fabricated event named
 * shop_open, which then fed name_valid / value_int / the caps rows. The guard
 * must reject a preceding identifier character while still allowing the dot of
 * the real `pi.logCustomEvent(` / `plbx_html.log_event(` forms.
 */
describe('call detection is anchored on an identifier boundary', () => {
  it('ignores identifiers that merely end with the tracked names', () => {
    const dir = mkTmp()
    write(
      dir,
      'main.js',
      "analytics.catalog_event('shop_open', 2);\n" +
        "ui.dialog_event('popup', 1);\n" +
        "tracker.mylogCustomEvent('nope', 1);\n" +
        '$log_event(name, 1);',
    )
    const usage = extractLunaUsage(dir)
    expect(usage.events).toEqual([])
    expect(usage.dynamicNames).toBe(0)
  })

  it('still matches the dotted and bare real call forms', () => {
    const dir = mkTmp()
    write(
      dir,
      'main.js',
      "pi.logCustomEvent('a', 1);\n" +
        "window.plbx_html.log_event('b', 1);\n" +
        "plbx_html.log_event('c', 1);\n" +
        "log_event('d', 1);",
    )
    expect(extractLunaUsage(dir).events.map((e) => e.name)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  it('does not fabricate a package-time warning from a foreign *_event call', async () => {
    const root = mkTmp()
    const build = join(root, 'web-mobile')
    write(
      build,
      'index.html',
      '<!DOCTYPE html><html><head></head><body><script src="main.js"></script></body></html>',
    )
    write(build, 'main.js', "analytics.catalog_event('shop open', 2);")
    const result = await packageForNetworks({
      buildDir: build,
      outputDir: join(root, 'out'),
      networks: ['luna'],
      config: { orientation: 'portrait' },
    })
    expect(
      (result.results[0].warnings ?? []).filter((w) => w.startsWith('Luna events')),
    ).toEqual([])
  }, 60_000)
})

describe('Axon names fired through the Luna channel', () => {
  // plbx_html.log_event exists only in a Luna build; ALPlayableAnalytics.trackEvent
  // is AppLovin's and the packager never touches it. Both directions fail SILENTLY
  // when confused: an Axon name sent through log_event lands in Luna as a
  // meaningless custom event, and on an AppLovin build the same call is a no-op.
  // Axon's own validator already errors on non-spec names, so only this direction
  // needed a guard.
  it('warns when an Axon spec name is logged as a Luna custom event', () => {
    const checks = validateLunaEvents({
      source: 'runtime',
      events: [
        { name: 'CHALLENGE_STARTED', count: 1 },
        { name: 'playtime_10s', count: 1 },
      ],
    })
    const c = checks.find((x) => x.id === 'axon_names')
    expect(c).toBeDefined()
    expect(c!.ok).toBe(false)
    expect(c!.level).toBe('warn')
    expect(c!.detail).toContain('CHALLENGE_STARTED')
  })

  it('stays silent when no Axon name is present', () => {
    const checks = validateLunaEvents({
      source: 'runtime',
      events: [{ name: 'playtime_10s', count: 1 }],
    })
    expect(checks.find((x) => x.id === 'axon_names')).toBeUndefined()
  })
})
