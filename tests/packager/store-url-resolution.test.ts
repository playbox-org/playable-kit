import { describe, it, expect } from 'vitest'
import { resolveStoreUrls } from '../../src/packager/packager'

describe('resolveStoreUrls', () => {
  it('splits by host', () => {
    expect(
      resolveStoreUrls([
        'https://play.google.com/store/apps/details?id=com.x',
        'https://apps.apple.com/us/app/x/id123',
      ]),
    ).toEqual({
      android: 'https://play.google.com/store/apps/details?id=com.x',
      ios: 'https://apps.apple.com/us/app/x/id123',
    })
  })

  it('handles itunes.apple.com and a missing side', () => {
    expect(resolveStoreUrls(['https://itunes.apple.com/app/id1'])).toEqual({
      ios: 'https://itunes.apple.com/app/id1',
    })
  })

  it('returns nothing for unrelated urls', () => {
    expect(resolveStoreUrls(['https://example.com'])).toEqual({})
  })

  it('keeps the first URL per store', () => {
    expect(
      resolveStoreUrls([
        'https://play.google.com/store/apps/details?id=com.first',
        'https://play.google.com/store/apps/details?id=com.second',
      ]).android,
    ).toBe('https://play.google.com/store/apps/details?id=com.first')
  })
})
