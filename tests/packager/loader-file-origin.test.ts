import { describe, it, expect } from 'vitest'
import vm from 'node:vm'
import { emitSharedHelpers } from '../../src/packager/loader/shared'
import { emitModuleHooks } from '../../src/packager/loader/modules'

/**
 * Behavioral tests for the loader's module resolution — the emitted browser JS
 * is actually EXECUTED here (node:vm) against a stub SystemJS, instead of being
 * string-matched.
 *
 * Regression: a Cocos build with a split `cc.js` (a re-export shim plus a
 * sibling `_virtual_cc-*.js` chunk — what the build emits once Spine/WASM is
 * included) black-screened when the packaged HTML was opened by double-click
 * (file://). resolve() collapsed every `file:` parent URL onto the BARE fake
 * origin, so the `cocos-js/` directory segment was lost; the engine's
 * `new URL('assets/spine-*.wasm', import.meta.url)` then produced
 * `https://plbx.local/assets/spine-*.wasm`, which misses the cache (the key is
 * `cocos-js/assets/spine-*.wasm`) and escapes to the real network. Cocos's wasm
 * loader swallows that failure without settling its promise, so engine init
 * hangs forever with no error. Over http:// the parent URL is not rewritten, the
 * segment survives and the cache hits — which is why the preview validator, and
 * any build whose `cc.js` is a single monolith, never saw it.
 */

interface LoaderEnv {
  resolve(id: string, parentUrl?: string): string
  findAsset(url: string): { data: string; binary: boolean } | null
}

function bootLoader(
  opts: { bin?: Record<string, string>; importmapCc?: string } = {},
): LoaderEnv {
  const sandbox: Record<string, unknown> = {
    console,
    URL,
    atob,
    TextEncoder,
    Promise,
  }
  sandbox.window = sandbox
  sandbox.__plbx_res = {}
  sandbox.__plbx_bin = opts.bin ?? {}
  sandbox.__plbx_js = {}
  sandbox.__importmap_cc = opts.importmapCc ?? ''

  const context = vm.createContext(sandbox)

  // Stub SystemJS: bare specifiers come from the importmap (already absolutized
  // against document.baseURI by SystemJS, hence file:// here), relative ids go
  // through the same URL algebra the real resolver uses.
  vm.runInContext(
    `
    function FakeSystem() {}
    FakeSystem.prototype.resolve = function (id, parentUrl) {
      if (id === 'cc') return window.__importmap_cc;
      return new URL(id, parentUrl).href;
    };
    FakeSystem.prototype.instantiate = function () {};
    FakeSystem.prototype.fetch = function () {};
    var System = new FakeSystem();
    `,
    context,
  )
  vm.runInContext(emitSharedHelpers(), context)
  vm.runInContext(emitModuleHooks({}), context)
  vm.runInContext('plbx_patch_system();', context)

  const System = sandbox.System as LoaderEnv & { resolve: LoaderEnv['resolve'] }
  const findAsset = vm.runInContext('_findAsset', context) as LoaderEnv['findAsset']
  return {
    resolve: (id, parentUrl) => System.resolve(id, parentUrl),
    findAsset,
  }
}

const FILE_CC = 'file:///Users/dev/build/plbx-html/cocos-js/cc.js'
const FAKE_CC = 'https://plbx.local/Users/dev/build/plbx-html/cocos-js/cc.js'

describe('module resolution under a file:// origin', () => {
  it('finds the spine wasm in the cache when the engine resolves it from a split cc.js', () => {
    const env = bootLoader({
      bin: { 'cocos-js/assets/spine-CC34fKUR.wasm': 'AAAA' },
    })

    // cc.js (shim) imports its sibling chunk relatively; that chunk's module id
    // becomes import.meta.url for the engine's wasm URL algebra.
    const chunkId = env.resolve('./_virtual_cc-C6Avrf5-.js', FILE_CC)
    const wasmUrl = new URL('assets/spine-CC34fKUR.wasm', chunkId).href

    expect(env.findAsset(wasmUrl)).not.toBeNull()
  })

  it('maps a file:// parent onto the fake origin without dropping its path', () => {
    expect(bootLoader().resolve('./sibling.js', FILE_CC)).toBe(
      'https://plbx.local/Users/dev/build/plbx-html/cocos-js/sibling.js',
    )
  })

  it('normalizes a file:// importmap target so the module id is origin-free', () => {
    expect(bootLoader({ importmapCc: FILE_CC }).resolve('cc')).toBe(FAKE_CC)
  })

  it('leaves http(s) parents untouched (the http:// path must not regress)', () => {
    expect(
      bootLoader().resolve('./assets/x.wasm', 'http://127.0.0.1:8777/cocos-js/cc.js'),
    ).toBe('http://127.0.0.1:8777/cocos-js/assets/x.wasm')
  })

  it('still collapses about:/blob: parents onto the bare fake origin', () => {
    const env = bootLoader()
    expect(env.resolve('./index.js', 'about:srcdoc')).toBe(
      'https://plbx.local/index.js',
    )
    expect(env.resolve('./index.js', 'blob:https://x/y')).toBe(
      'https://plbx.local/index.js',
    )
  })
})
