import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string
}

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    networks: 'src/networks.ts',
    types: 'src/types.ts',
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
})
