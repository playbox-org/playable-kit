import { describe, it, expect } from 'vitest'
import {
  buildVersionBanner,
  PACKAGER_NAME,
  PACKAGER_ORIGIN,
} from '../../src/packager/version-banner'

describe('version-banner', () => {
  it('exposes the kit name and GitHub origin', () => {
    expect(PACKAGER_NAME).toBe('@playbox-ai/playable-kit')
    expect(PACKAGER_ORIGIN).toBe(
      'https://github.com/playbox-org/playable-kit',
    )
  })

  it('builds a console.log banner with name, origin and v-prefixed version', () => {
    const banner = buildVersionBanner('0.2.3')
    expect(banner).toContain('console.log')
    expect(banner).toContain('@playbox-ai/playable-kit')
    expect(banner).toContain('https://github.com/playbox-org/playable-kit')
    expect(banner).toContain('v0.2.3')
  })

  it('does not double the v prefix when version already starts with v', () => {
    const banner = buildVersionBanner('v0.2.3')
    expect(banner).toContain('v0.2.3')
    expect(banner).not.toContain('vv0.2.3')
  })

  it('produces a single-line script-safe string (no raw </script>)', () => {
    const banner = buildVersionBanner('0.2.3')
    expect(banner).not.toContain('</script>')
  })
})
