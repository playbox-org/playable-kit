import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import { JSZIP_MIN_JS, JSZIP_VERSION } from '../src/generated/jszip-min'
import { KIT_VERSION } from '../src/version'

const require = createRequire(import.meta.url)

describe('generated jszip embed', () => {
  it('contains the full minified jszip source', () => {
    expect(JSZIP_MIN_JS.length).toBeGreaterThan(50_000)
    expect(JSZIP_MIN_JS).toContain('JSZip')
  })

  it('matches the installed jszip version', () => {
    const installed = (require('jszip/package.json') as { version: string })
      .version
    expect(JSZIP_VERSION).toBe(installed)
  })
})

describe('KIT_VERSION', () => {
  it('falls back to the dev marker when running from source', () => {
    expect(KIT_VERSION).toBe('0.0.0-dev')
  })
})
