import { Orientation, PackageConfig } from '../../types'
import { packDirectoryToZip } from '../asset-inliner'
import { BaseAdapter, ZipExtraFile, ZipExtraFilesContext } from './base'

/** `plbx.json` — the metadata member of the repack-source archive. */
export interface PlbxMeta {
  kitVersion: string
  appName: string
  orientation: Orientation
  storeUrls: { googlePlay: string; appStore: string }
  /** ISO 8601 */
  createdAt: string
}

/**
 * The archive's three root members. Typed `readonly string[]`, not `as const`:
 * a tuple literal's `.includes(x: string)` is TS2345 under `strict`.
 */
export const PLBX_ARCHIVE_MEMBERS: readonly string[] = [
  'source.html',
  'build.zip',
  'plbx.json',
]

/**
 * Playbox repack-source adapter.
 *
 * `plbx` is not a delivery network: it is the ONE archive the extension hands
 * to the private repack service, which turns it into every per-network
 * artifact (and injects telemetry). The archive is exactly:
 *
 *   source.html  the ordinary kit output for this target — self-contained
 *                loader, default Cocos rewrite, plain bridge, telemetry slot.
 *                Runnable and reviewable, produced by the packager's shared
 *                single-file branch; nothing here touches it.
 *   build.zip    the build directory exactly as built — every file, no
 *                exclusions, no rewrite, paths relative to buildDir, forward
 *                slashes. Lossless by construction: the repack service
 *                extracts it and runs packageForNetworks on it unmodified.
 *   plbx.json    PlbxMeta — the packager hands this target the same resolved
 *                store URLs / appName luna.json gets.
 *
 * Like Luna, it ships no network wrapper (`mraid: false` in the registry also
 * makes `mraid.js` a forbidden string).
 */
export class PlbxAdapter extends BaseAdapter {
  async getZipExtraFiles(
    config: PackageConfig,
    ctx?: ZipExtraFilesContext,
  ): Promise<ZipExtraFile[]> {
    if (!ctx) {
      throw new Error('plbx target needs the packager context (buildDir)')
    }
    // The whole build, as built: no excludeExtensions, no transform — that is
    // the entire point of this member.
    const buildZip = await packDirectoryToZip(ctx.buildDir)
    const meta: PlbxMeta = {
      kitVersion: ctx.kitVersion,
      appName: config.appName || '',
      orientation: config.orientation,
      storeUrls: {
        googlePlay: config.storeUrlAndroid || '',
        appStore: config.storeUrlIos || '',
      },
      createdAt: new Date().toISOString(),
    }
    return [
      { zipPath: 'build.zip', content: buildZip },
      { zipPath: 'plbx.json', content: JSON.stringify(meta, null, 2) },
    ]
  }
}
