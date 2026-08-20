import * as fs from 'fs'
import { join, extname } from 'path'
import type { AxonCheck } from './axon-events'

/**
 * Luna / Unity Playworks analytics conformance.
 *
 * Spec: https://docs.lunalabs.io/docs/playable/playable-setup/analytics/custom-events
 * Standard events: https://docs.lunalabs.io/docs/playable/playable-setup/analytics/standard-events
 *
 * Luna is an authoring/export platform, not a delivery network: it injects its
 * own SDK (`window.pi`, `window.Luna`) and the standard ad events at EXPORT
 * time. What the creative owns is the custom-event channel:
 *
 *   window.pi.logCustomEvent('level_1', 1)
 *
 * Rules we check (spec §6 of docs/networks/luna-playworks.md):
 *   - 256 events per session, 32 per unique name — Luna drops the overflow, so
 *     an over-firing funnel silently loses its tail.
 *   - No event before Luna calls startGame() ("avoid logging any event during
 *     the initialisation phase").
 *   - Names non-empty and whitespace-free; string-named events carry an integer
 *     value (a value missing from a direct pi.logCustomEvent() call is a silent
 *     drop on Luna's side — the plbx_html.log_event bridge defaults it itself).
 *   - Every CTA goes through Luna.Unity.Playable.InstallFullGame() — Luna's
 *     standard Ad Click fires from there and nowhere else.
 *   - The creative never assigns window.pi / window.Luna itself.
 *
 * Split mirrors axon-events.ts: a filesystem extractor for the package-time
 * gate, plus a PURE validator that both the gate and the preview panel use. The
 * caps are inherently RUNTIME facts — the static scan can only count call
 * sites, so the preview mock feeds the same validator with real fire counts and
 * the caps rows are emitted ONLY for `source: 'runtime'` usage (see
 * LunaEventUsage). The package-time gate therefore checks names, values,
 * dynamic names and SDK redefinition; the caps verdict belongs to the preview.
 */

/** Luna custom-event documentation (the rule source for the checks below). */
export const LUNA_SPEC_URL =
  'https://docs.lunalabs.io/docs/playable/playable-setup/analytics/custom-events'

/**
 * Standard events Luna injects at export time — we emit no code for them. Listed
 * so the preview can simulate them (they are absent locally) and so a custom
 * event colliding with one of these names is recognisable.
 */
export const LUNA_STANDARD_EVENTS = [
  'adLoading',
  'adReady',
  'adStarting',
  'adImpression',
  'adEngagement',
  'adClick',
] as const

/** Luna's hard analytics ceilings — events past them are dropped, not queued. */
export const LUNA_EVENT_CAPS = { perSession: 256, perName: 32 } as const

/** File extensions we treat as text/source and scan for custom-event calls. */
const SCANNABLE_EXTENSIONS = new Set(['.js', '.json', '.html', '.txt'])

// Every custom-event call site, in BOTH spellings the creative can use:
//
//   pi.logCustomEvent('level_1', 1)          // Luna's SDK, called directly
//   plbx_html.log_event('level_1', 1)        // our channel (spec §3.5)
//
// The second one is the sanctioned integration path — the packager injects
// `window.plbx_html.log_event` and forwards it to pi.logCustomEvent itself — so
// a game written against the plbx/super_html channel never types
// "logCustomEvent" anywhere. Matching only the SDK spelling made the whole
// static gate report "no events" and every rule in spec §6 no-op for exactly
// the integration this kit ships. `\s*\(` (not `\s*=`) keeps the channel's own
// DEFINITION (`window.plbx_html.log_event = function(...)`) out of the count.
//
// Classified afterwards against LITERAL_ARGS_RE rather than by one regex,
// because a concatenated name STARTS with a quote ('playtime_' + n + 's') — a
// "first arg is not a string literal" test would mis-file it as a literal.
//
// The `(?:^|[^\w$])` prefix is an identifier boundary, same discipline as
// REDEFINE_RE — WITHOUT the dot in its negated class, because both real call
// forms are member accesses (`pi.logCustomEvent(`, `plbx_html.log_event(`) and
// excluding '.' would reject exactly the calls we came for. What it must reject
// is a LONGER identifier merely ending in one of the two names: unguarded,
// `analytics.catalog_event('shop_open', 2)` (catalog_event ends with log_event)
// extracted a fabricated Luna event named shop_open, which then fed name_valid,
// value_int and the caps rows.
//
// Group 1 is the spelling, and it is load-bearing rather than incidental: the
// value rule differs between the two (see isIntegerish).
const CALL_RE = /(?:^|[^\w$])(logCustomEvent|log_event)\s*\(/g

// The argument list of a literal call, anchored at the '(' — name in group 2,
// the raw value expression (if any) in group 3.
const LITERAL_ARGS_RE = /^\s*(['"])([^'"]*)\1\s*(?:,\s*([^)]*?))?\s*\)/

// Assignment to the SDK globals Luna's exporter provides. Deliberately narrower
// than a bare `pi =` / `Luna =`: minified Cocos output is full of property
// writes like `t.pi=Math.PI`, and a local binding (`var Luna = require(...)`,
// `, Luna = e.Luna`) is not a redefinition — only an explicit global write is.
// A bare-`Luna =` alternative used to live here and made no_sdk_redefine (the
// ONE check that also fires on the empty-usage path) a hard ERROR for any build
// whose sources happen to contain a local named `Luna` — a project with zero
// custom events could fail packaging over a variable name. The negative
// lookahead skips the comparison operators in defensive guards
// (`window.pi === undefined`, `window.Luna == null`).
const REDEFINE_RE =
  /(?:^|[^.\w$])(?:window|globalThis|self)\s*\.\s*(?:pi|Luna)\s*=(?![=])/

/**
 * One event name with everything the caller could observe about its firing.
 *
 * `source` is load-bearing, not decoration: `count` means TWO different things
 * depending on where the usage came from, and the caps rules (32 per name / 256
 * per session) are only meaningful for one of them.
 *
 *   - `'static'` — from extractLunaUsage(): `count` is the number of CALL SITES
 *     in the source. A loop firing one call site 100× has count 1 (a green
 *     caps verdict on a creative Luna will truncate); a minifier that repeats
 *     one literal in 33 places has count 33 (a red verdict on a creative that
 *     fires it once). Both directions are wrong, so caps are NOT emitted here.
 *   - `'runtime'` — from the preview mock: `count` is the real fire count, and
 *     the caps verdicts mean what they say.
 *
 * Anything derived from a file scan is 'static'. If you are tempted to pass
 * 'runtime' for a source-derived usage, you are asking the validator to green-
 * light a rule it has no data for.
 */
export interface LunaEventUsage {
  /** Provenance of `count` (and of the runtime-only flags below). See above. */
  source: 'static' | 'runtime'
  events: Array<{
    name: string
    /** Static scan: call sites. Runtime (preview): actual fire count. */
    count: number
    /** False when a call passes no value, or a non-integer one. Omitted = unknown. */
    valueOk?: boolean
    /** True when the event fired before startGame() ran. Runtime-only signal. */
    beforeStart?: boolean
  }>
  /** logCustomEvent calls whose name is built at runtime — unverifiable, not a failure. */
  dynamicNames?: number
  /** Whether the source assigns window.pi / window.Luna. Omitted = unknown (runtime). */
  redefinesSdk?: boolean
  /** Whether every CTA went through InstallFullGame(). Runtime-only signal. */
  ctaViaInstall?: boolean
}

/**
 * Same row shape as the Axon checklist (both feed the same panel widget), with
 * one extra level: 'info' for rows that report an unverifiable fact rather than
 * a pass/fail verdict.
 */
export type LunaCheck = Omit<AxonCheck, 'level'> & {
  level: AxonCheck['level'] | 'info'
}

/**
 * Recursively scan a build directory's source files for Luna analytics usage:
 * literal logCustomEvent()/plbx_html.log_event() names with their call-site counts, the number of
 * runtime-built names, and whether the source (re)defines the SDK globals.
 * Returns empty usage for a missing/unreadable directory (never throws) — same
 * discipline as extractAxonUsage: the calls live in the game's plaintext JS.
 */
export function extractLunaUsage(buildDir: string): LunaEventUsage {
  const order: string[] = []
  const counts = new Map<string, number>()
  const valueOk = new Map<string, boolean>()
  let dynamicNames = 0
  let redefinesSdk = false

  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return // missing/unreadable dir — skip silently
    }

    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!SCANNABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue

      let content: string
      try {
        content = fs.readFileSync(full, 'utf8')
      } catch {
        continue // unreadable file — skip
      }

      let m: RegExpExecArray | null
      CALL_RE.lastIndex = 0
      while ((m = CALL_RE.exec(content)) !== null) {
        const args = LITERAL_ARGS_RE.exec(content.slice(m.index + m[0].length))
        if (!args) {
          dynamicNames++
          continue
        }
        const name = args[2]
        if (!counts.has(name)) order.push(name)
        counts.set(name, (counts.get(name) || 0) + 1)
        // A name is only "value ok" when EVERY call site passes an integer-ish
        // value; one bad site is enough to lose that event on Luna's side.
        // The verdict is per CALL SITE, not per name, because the two spellings
        // do not have the same failure mode — hence m[1].
        const ok = isIntegerish(args[3], m[1] === 'log_event')
        valueOk.set(name, (valueOk.get(name) ?? true) && ok)
      }

      if (!redefinesSdk && REDEFINE_RE.test(content)) redefinesSdk = true
    }
  }

  walk(buildDir)

  return {
    // Call sites, never fire counts — see LunaEventUsage.source.
    source: 'static',
    events: order.map((name) => ({
      name,
      count: counts.get(name) || 0,
      valueOk: valueOk.get(name) ?? false,
    })),
    dynamicNames,
    redefinesSdk,
  }
}

/**
 * Whether a raw value argument can be an integer. A quoted string never can; an
 * identifier or expression is accepted — we cannot evaluate it statically and
 * refuse to cry wolf over it.
 *
 * `viaBridge` is the call SHAPE, and it decides the missing-argument case,
 * which is the only one where the two spellings disagree:
 *   - `pi.logCustomEvent('x')` reaches Luna with no value → the documented
 *     silent drop, worth a warning.
 *   - `plbx_html.log_event('x')` goes through the channel we inject, and that
 *     bridge supplies the value itself (`var v = (typeof value === 'number' &&
 *     isFinite(value)) ? (value | 0) : 1;` — see base.ts). Nothing is dropped,
 *     so warning here flags our own sanctioned integration as broken.
 * A non-numeric literal still warns in BOTH spellings: the bridge substitutes
 * 1, so the number the author asked for is not the number Luna records.
 */
function isIntegerish(raw: string | undefined, viaBridge = false): boolean {
  const v = (raw || '').trim()
  if (!v) return viaBridge
  if (/^['"`]/.test(v)) return false
  if (/^-?\d/.test(v)) return /^-?\d+$/.test(v)
  return true
}

/**
 * Validate Luna analytics usage. Pure — used by both the package-time gate
 * (static source scan) and the preview panel (runtime counts from the mock).
 * Conditional rules only emit a check when their signal is actually available,
 * so the checklist carries no "n/a — pass" noise.
 */
export function validateLunaEvents(usage: LunaEventUsage): LunaCheck[] {
  const checks: LunaCheck[] = []
  const { source, events, dynamicNames = 0, redefinesSdk, ctaViaInstall } = usage

  if (events.length === 0) {
    // Custom events are optional — a project that fires none gets no advisory
    // noise. Only redefining the SDK globals is still worth flagging: it breaks
    // Luna's own injection whether or not we ever log an event.
    if (redefinesSdk) checks.push(redefinitionCheck(true))
    return checks
  }

  // Caps are RUNTIME facts and are emitted only for runtime usage. A static
  // scan counts call sites, so emitting them there gives a false green to the
  // exact shape Luna truncates (one call site inside a loop firing 100×) and a
  // bogus ERROR to a harmless one (a minifier repeating one literal 33×). Same
  // gating discipline as events_before_start / cta_via_install below.
  if (source === 'runtime') {
    const over = events.filter((e) => e.count > LUNA_EVENT_CAPS.perName)
    checks.push({
      id: 'caps_per_name',
      label: `No event name fired more than ${LUNA_EVENT_CAPS.perName}×`,
      ok: over.length === 0,
      level: 'error',
      detail: `Luna drops everything past ${LUNA_EVENT_CAPS.perName} fires of one name — ${over
        .map((e) => `${e.name}×${e.count}`)
        .join(', ')}`,
    })

    const total = events.reduce((sum, e) => sum + e.count, 0)
    checks.push({
      id: 'caps_session',
      label: `Session total within ${LUNA_EVENT_CAPS.perSession} events`,
      ok: total <= LUNA_EVENT_CAPS.perSession,
      level: 'error',
      detail: `${total} events in the session — Luna records at most ${LUNA_EVENT_CAPS.perSession}.`,
    })
  }

  // Runtime-only signal: a static scan cannot know when a call site runs.
  if (events.some((e) => e.beforeStart !== undefined)) {
    const early = events.filter((e) => e.beforeStart)
    checks.push({
      id: 'events_before_start',
      label: 'No events logged before startGame()',
      ok: early.length === 0,
      level: 'warn',
      detail: `Luna asks to avoid logging during initialisation — ${early
        .map((e) => e.name)
        .join(', ')} fired before startGame() ran.`,
    })
  }

  const badNames = events.filter((e) => !/^\S+$/.test(e.name))
  checks.push({
    id: 'name_valid',
    label: 'Event names non-empty and whitespace-free',
    ok: badNames.length === 0,
    level: 'error',
    detail: `unusable event name(s): ${badNames.map((e) => JSON.stringify(e.name)).join(', ')}`,
  })

  if (events.some((e) => e.valueOk !== undefined)) {
    const noValue = events.filter((e) => e.valueOk === false)
    checks.push({
      id: 'value_int',
      label: 'Every event carries an integer value',
      ok: noValue.length === 0,
      level: 'warn',
      detail: `Luna needs an integer parameter for a string-named event; a missing one is a silent drop — ${noValue
        .map((e) => e.name)
        .join(', ')}`,
    })
  }

  // Runtime-only signal (which API the observed CTA went through).
  if (ctaViaInstall !== undefined) {
    checks.push({
      id: 'cta_via_install',
      label: 'CTA routed through InstallFullGame()',
      ok: ctaViaInstall,
      level: 'error',
      detail:
        "Luna's standard Ad Click fires only from Luna.Unity.Playable.InstallFullGame() — a direct window.open() is never counted.",
    })
  }

  if (redefinesSdk !== undefined) checks.push(redefinitionCheck(redefinesSdk))

  if (dynamicNames > 0) {
    checks.push({
      id: 'dynamic_names',
      label: `${dynamicNames} event name(s) built at runtime`,
      ok: true,
      level: 'info',
      detail:
        'Names assembled at runtime (e.g. "playtime_" + n + "s") are expected, but cannot be checked statically — surfaced so the count is not read as "no events".',
    })
  }

  return checks
}

function redefinitionCheck(redefines: boolean): LunaCheck {
  return {
    id: 'no_sdk_redefine',
    label: 'Does not redefine window.pi / window.Luna',
    ok: !redefines,
    level: 'error',
    detail:
      "Luna's exporter injects both globals — assigning them yourself replaces the SDK and drops every event.",
  }
}
