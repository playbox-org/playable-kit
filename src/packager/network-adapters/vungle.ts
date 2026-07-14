import { NetworkConfig, PackageConfig } from '../../types'
import { BaseAdapter, vungleBridge } from './base'

/**
 * Vungle adapter.
 * Non-MRAID (`mraid: false` in the network config) — must not inject
 * mraid.js. CTA and game-end signal the ad container via `parent.postMessage`
 * rather than an SDK global; see `vungleBridge()` in base.ts for the exact
 * wire format and its sync counterpart, the Vungle preview mock.
 */
export class VungleAdapter extends BaseAdapter {
  constructor(networkId: string, networkConfig: NetworkConfig) {
    super(networkId, networkConfig)
  }

  protected getPlbxBridge(_config: PackageConfig): string {
    return vungleBridge()
  }
}
