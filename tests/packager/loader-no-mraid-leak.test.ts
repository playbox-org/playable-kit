import { describe, it, expect } from 'vitest'
import { emitSharedHelpers } from '../../src/packager/loader/shared'
import { emitLifecycle } from '../../src/packager/loader/lifecycle'
import { generateSelfContainedLoader } from '../../src/packager/loader'

// Facebook/Moloco validators reject any HTML containing the literal `mraid.js`
// ("Playable shouldn't include the 'mraid.js' function"). The self-contained
// loader is emitted into EVERY build, including non-MRAID networks (mraid:false,
// e.g. facebook/moloco) where no `<script src="mraid.js">` is injected — so the
// network-agnostic loader source must not leak the token itself. Real MRAID
// networks still get their legit `<script src="mraid.js">` from BaseAdapter.
describe('self-contained loader does not leak mraid tokens (FB/Moloco validator)', () => {
  it('emitSharedHelpers() contains no mraid token', () => {
    expect(emitSharedHelpers()).not.toMatch(/mraid/i)
  })

  it('emitLifecycle() contains no mraid token', () => {
    expect(emitLifecycle({})).not.toMatch(/mraid/i)
  })

  it('assembled loader ships no whole-line comments and no mraid token', () => {
    const loader = generateSelfContainedLoader({})
    expect(loader).not.toMatch(/mraid/i)
    const commentLines = loader
      .split('\n')
      .filter((l) => l.trim().startsWith('//'))
    expect(commentLines).toEqual([])
  })
})
