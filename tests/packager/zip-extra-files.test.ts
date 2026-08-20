import { describe, it, expect } from 'vitest'
import { BaseAdapter } from '../../src/packager/network-adapters/base'

describe('getZipExtraFiles', () => {
  it('defaults to an empty list', () => {
    const a = new BaseAdapter('x', {
      id: 'x',
      name: 'X',
      format: 'zip',
      maxSize: 1,
      mraid: false,
      inlineAssets: true,
    })
    expect(a.getZipExtraFiles({ orientation: 'auto' })).toEqual([])
  })
})
