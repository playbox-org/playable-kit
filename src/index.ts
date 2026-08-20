export { KIT_VERSION } from './version'
export * from './networks'
export type * from './types'

// Packaging
export {
  packageForNetworks,
  resolveSplashLogoDataUrl,
} from './packager/packager'
export type { PackagerOptions, PackagerResult } from './packager/types'
export { resolveTemplate } from './packager/template-resolver'
export { buildOutputRows } from './packager/output-listing'
export type { OutputBuildRow, OutputFileStat } from './packager/output-listing'
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
// The loading splash. Exported so a consumer's UI can render the exact markup +
// CSS that ships in the build (and price it) instead of keeping its own copy.
export {
  buildSplash,
  clampLogoScale,
  splashByteCost,
  DEFAULT_LOGO_SCALE,
  MIN_LOGO_SCALE,
  MAX_LOGO_SCALE,
  FIRST_FRAME_HOOK_JS,
} from './packager/splash'
export type { SplashOptions, SplashParts } from './packager/splash'

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
  parseHostileMp3Marker,
  parseRiskyAudioMarker,
  riskyAudioMarker,
} from './validation/audio-format-check'
export {
  AXON_EVENTS,
  AXON_SPEC_URL,
  extractAxonUsage,
  validateAxonEvents,
} from './validation/axon-events'
export type { AxonCheck, AxonUsage } from './validation/axon-events'
export {
  LUNA_EVENT_CAPS,
  LUNA_SPEC_URL,
  LUNA_STANDARD_EVENTS,
  extractLunaUsage,
  validateLunaEvents,
} from './validation/luna-events'
export type { LunaCheck, LunaEventUsage } from './validation/luna-events'
export {
  IOS_AUDIO_RISK_CTA,
  findForbiddenLiterals,
  summarizeChecks,
  validateArtifact,
} from './validation/validate-artifact'
export type {
  ArtifactFileCheckInput,
  ValidateArtifactInput,
} from './validation/validate-artifact'
export {
  MIN_SAFE_LOADER_VERSION,
  scanLoaderHealth,
} from './validation/loader-health'
export type { LoaderCheck } from './validation/loader-health'
export {
  CTA_LABELS,
  getNetworkChecks,
  MOLOCO_V2_TRACKED_MACROS,
} from './checks/network-checks'
export type { CheckDef } from './checks/network-checks'
export { generatePreviewUtil } from './preview/sdk-mocks'
export type { PreviewUtilParams } from './preview/sdk-mocks'
export {
  buildPreviewRendition,
  PREVIEW_MODES,
} from './preview/preview-rendition'
export type {
  PreviewMode,
  PreviewRenditionInput,
} from './preview/preview-rendition'
