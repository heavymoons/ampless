> 日本語版: [README.ja.md](./README.ja.md)
> 

# ampless

CMS core library for AWS Amplify.

> **Pre-release / alpha.** Breaking changes possible in any minor version until v1.0. See the [root README](https://github.com/heavymoons/ampless#readme) for full docs.

## Overview

`ampless` is the core library that powers the [ampless](https://github.com/heavymoons/ampless) CMS. It exposes:

- `defineConfig()` — the user-facing `cms.config.ts` schema
- `defineSchema()` — content type definitions (full custom-content-type system planned)
- The `Post` / `Page` / `Media` / `AuthContext` shared types
- The plugin contract (`definePlugin`, `AmplessPlugin`, hooks, `PluginRuntimeContext`, event types, `escapeXml` / `formatPublicAssetUrl`)
- A DI-style `setPostsProvider()` that the templates' Amplify-data wrapper plugs into; without one the API serves built-in dummy posts so users can prototype before wiring AWS

You usually don't depend on `ampless` directly — it's pulled in transitively by `create-ampless`'s blog template and by every `@ampless/plugin-*`. Install it directly only if you're writing your own plugin or theme.

## Installation

```bash
npm install ampless@alpha
```

## Usage

```ts
import { defineConfig } from 'ampless'

export default defineConfig({
  site: {
    name: 'My Blog',
    url: 'https://example.com',
  },
  plugins: [],
})
```

## Requirements

- Node.js >= 22
- AWS Amplify Gen 2

## License

[MIT](../../LICENSE)
