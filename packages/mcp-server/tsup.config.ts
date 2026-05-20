import { defineConfig } from 'tsup'

// Two output entries:
//
// 1. CLI (`dist/index.js`) — what `npx @ampless/mcp-server@alpha`
//    invokes. Bundled with the AWS SDK / Cognito SDK / MCP SDK
//    inlined for a no-install one-shot.
//
// 2. Tools library (`dist/tools/index.js`) — re-uses the same tool
//    handlers from a Next.js Lambda runtime that supplies its own
//    GraphQL / S3 client (see `@ampless/admin/api/mcp`). Tool files
//    import the abstract `GraphqlClient` / `StorageClient`
//    interfaces from `./types.js` (no SDK deps), so the consumer
//    chooses what backing client to pass.
//
// The shebang ends up on both entries; ESM ignores shebangs in
// `import`s so it's harmless on the library entry.
export default defineConfig({
  entry: ['src/index.ts', 'src/tools/index.ts'],
  format: ['esm'],
  banner: { js: '#!/usr/bin/env node' },
  bundle: true,
  noExternal: [/@modelcontextprotocol/, /@aws-sdk/, /amazon-cognito-identity-js/],
  dts: true,
  clean: true,
  target: 'node20',
})
