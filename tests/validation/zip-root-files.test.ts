import { describe, it, expect } from 'vitest'
import { zipRootFilesVerdict } from '../../src/validation/zip-root-files'
import { validateArtifact } from '../../src/validation/validate-artifact'
import { getNetworkChecks } from '../../src/checks/network-checks'
import { NETWORKS } from '../../src/networks'

// One rule for three surfaces: the registry declares the root files, this
// verdict decides, and validateArtifact / the extension preview / the platform
// validator all render the same answer.
describe('zipRootFilesVerdict', () => {
  it('is null for networks that declare no root files', () => {
    expect(zipRootFilesVerdict('applovin', ['index.html'])).toBeNull()
    expect(zipRootFilesVerdict('tiktok', ['index.html'])).toBeNull()
    expect(zipRootFilesVerdict('nope', ['index.html'])).toBeNull()
  })

  it('passes a Tencent archive with config.json at the root', () => {
    const v = zipRootFilesVerdict('gdt', ['index.html', 'config.json'])
    expect(v).toMatchObject({ required: ['config.json'], missing: [], details: null })
  })

  it('tells "absent" and "misplaced" apart — they need opposite advice', () => {
    const absent = zipRootFilesVerdict('gdt', ['index.html'])!
    expect(absent.absent).toEqual(['config.json'])
    expect(absent.misplaced).toEqual([])
    expect(absent.details).toContain('Missing config.json')
    expect(absent.details).toContain('Tencent Ads')

    const wrapped = zipRootFilesVerdict('gdt', ['game/index.html', 'game/config.json'])!
    expect(wrapped.misplaced).toEqual(['config.json'])
    expect(wrapped.absent).toEqual([])
    expect(wrapped.details).toContain('inside game/')
    expect(wrapped.details).toContain("zip the build folder's contents")
  })

  it('covers Luna manifests, tolerating directory entries and backslashes', () => {
    const ok = zipRootFilesVerdict('luna', ['source.html', 'luna.json', 'playground.json', 'assets/'])!
    expect(ok.missing).toEqual([])
    const half = zipRootFilesVerdict('luna', ['source.html', 'luna.json', 'sub\\playground.json'])!
    expect(half.misplaced).toEqual(['playground.json'])
    expect(half.details).toContain('inside sub/')
  })

  it('validateArtifact emits zip-root-files only when entries are given', () => {
    const base = { networkId: 'gdt', html: '<html></html>', files: [] }
    expect(validateArtifact(base).some((c) => c.id === 'zip-root-files')).toBe(false)
    const withEntries = validateArtifact({ ...base, zipEntries: ['index.html'] })
    const check = withEntries.find((c) => c.id === 'zip-root-files')
    expect(check?.status).toBe('failed')
    expect(check?.details).toContain('config.json')
    const good = validateArtifact({ ...base, zipEntries: ['index.html', 'config.json'] })
    expect(good.find((c) => c.id === 'zip-root-files')?.status).toBe('passed')
  })

  it('getNetworkChecks carries a zip_root_files def exactly for declaring networks', () => {
    for (const id of Object.keys(NETWORKS)) {
      const has = getNetworkChecks(id, NETWORKS[id].mraid).some((c) => c.id === 'zip_root_files')
      expect(has, id).toBe(Boolean(NETWORKS[id].zipRootFiles?.length))
    }
    const gdt = getNetworkChecks('gdt', false)
    expect(gdt.find((c) => c.id === 'zip_root_files')?.label).toBe('Archive root has config.json')
    expect(gdt.find((c) => c.id === 'cta')?.hint).toContain('playAble.onClick')
  })
})
