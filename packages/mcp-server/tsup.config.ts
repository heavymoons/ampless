import { defineConfig } from 'tsup'

// Three subpath entries:
//   ./tools    — tool registry (getTools, dispatchToolCall, ToolDefinition)
//   ./jsonrpc  — shared JSON-RPC 2.0 dispatch (dispatchJsonRpc + helpers)
//   ./public   — read-only public tools (publicTools, PublicToolContext)
//
// `./tools` + `./jsonrpc` are bundled into the @ampless/backend
// mcp-handler Lambda; `./public` is consumed by @ampless/runtime.
//
// fflate is inlined because it is a small pure-ESM dep and Lambda
// bundling is simpler without external resolution.
export default defineConfig({
  entry: ['src/tools/index.ts', 'src/jsonrpc/index.ts', 'src/public/index.ts'],
  format: ['esm'],
  bundle: true,
  noExternal: [/fflate/],
  dts: true,
  clean: true,
  target: 'node22',
})
