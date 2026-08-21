/**
 * An empty, versioned extension point.
 *
 * Everything a packaged artifact does at runtime is in this repository except
 * one thing: reporting to a server. That belongs to whoever packaged the build,
 * not to the build, so the kit leaves a marked, empty slot and nothing else.
 *
 * A patcher replaces the body between the marker and the closing tag. The
 * marker is versioned so a patcher that predates a format change can tell.
 *
 * Emitted AFTER the network adapter has installed the bridge: anything patched
 * in here is expected to wrap what the adapters left, and a slot emitted before
 * them would have nothing to wrap.
 */
export const TELEMETRY_SLOT_MARKER = '<!--plbx-telemetry:v1-->'

export function telemetrySlot(): string {
  return `${TELEMETRY_SLOT_MARKER}<script>window.__plbx_pi=function(){};</script>`
}
