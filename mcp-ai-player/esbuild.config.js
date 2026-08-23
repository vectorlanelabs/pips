import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node21',
  banner: { js: '#!/usr/bin/env node' },
  // node-datachannel ships a native binary and must be resolved at
  // runtime from node_modules, not bundled; peerjs pulls in a few
  // browser-oriented optional deps that only resolve correctly if left
  // external too.
  external: ['node-datachannel', 'peerjs'],
})
