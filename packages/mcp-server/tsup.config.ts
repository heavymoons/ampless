import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  banner: { js: '#!/usr/bin/env node' },
  bundle: true,
  noExternal: [/@modelcontextprotocol/, /@aws-sdk/, /amazon-cognito-identity-js/],
  dts: true,
  clean: true,
  target: 'node20',
})
