export { KIT_VERSION } from './version'
export * from './networks'
export type * from './types'

// Packaging
export {
  packageForNetworks,
  resolveSplashLogoDataUrl,
} from './packager/packager'
export type { PackagerOptions, PackagerResult } from './packager/types'
export {
  buildLauncher,
  effectiveLauncherBytes,
  fillLauncherPayloadUrl,
  LAUNCHER_MAX_BYTES,
  MOLOCO_V2_MACRO_SPEC,
  validateLauncher,
} from './packager/launcher-builder'
export type { LauncherCheck } from './packager/launcher-builder'
export { HtmlBuilder } from './packager/html-builder'

// Validation
export {
  detectRegionalParams,
  extractStoreUrls,
  fixRegionalStoreUrls,
  stripRegionalParams,
} from './validation/store-url-extractor'
export {
  detectHostileMp3,
  detectRiskyAudio,
  hostileMp3Marker,
  riskyAudioMarker,
} from './validation/audio-format-check'
export {
  AXON_EVENTS,
  extractAxonUsage,
  validateAxonEvents,
} from './validation/axon-events'
export type { AxonCheck, AxonUsage } from './validation/axon-events'
