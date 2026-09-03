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
    // Must NOT clean — this config builds after the entry above and clean:true
    // would wipe its output (index/networks/types/sdk .js/.cjs/.d.ts).
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
    define: {
      __KIT_VERSION__: JSON.stringify(pkg.version),
    },
  },
])
