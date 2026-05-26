import { defineConfig } from 'tsup'

// Tools library only — bundled into the @ampless/backend mcp-handler Lambda.
//
// The `./tools` subpath export provides the tool registry
// (`getTools`, `dispatchToolCall`, `ToolDefinition`) consumed by
// `packages/backend/src/functions/mcp-handler.ts`.
//
// fflate is inlined because it is a small pure-ESM dep and Lambda
// bundling is simpler without external resolution.
export default defineConfig({
  entry: ['src/tools/index.ts'],
  format: ['esm'],
  bundle: true,
  noExternal: [/fflate/],
  dts: true,
  clean: true,
  target: 'node22',
})
