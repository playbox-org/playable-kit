import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string
}

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      networks: 'src/networks.ts',
      types: 'src/types.ts',
      sdk: 'src/sdk/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    treeshake: true,
    minify: false,
    sourcemap: false,
    define: {
      __KIT_VERSION__: JSON.stringify(pkg.version),
    },
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['cjs'],
    dts: false,
    // Must NOT clean — tsup runs multi-config arrays concurrently, and a
    // second clean:true here would race-delete the other config's output
    // (index/networks/types/sdk .js/.cjs/.d.ts) instead of just clearing dist/
    // once up front.
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
    define: {
      __KIT_VERSION__: JSON.stringify(pkg.version),
    },
  },
  {
    // Script-tag build of the SDK for free-stack builds with no bundler step
    // of their own: `<script src="sdk.iife.js"></script>` leaves `window.plbx`
    // ready to use, same object the `@playbox-ai/playable-kit/sdk` import gives.
    entry: { 'sdk.iife': 'src/sdk/index.ts' },
    format: ['iife'],
    globalName: 'plbxSdk',
    dts: false,
    clean: false,
    minify: true,
    define: {
      __KIT_VERSION__: JSON.stringify(pkg.version),
    },
    footer: { js: 'window.plbx = plbxSdk.plbx;' },
  },
])
