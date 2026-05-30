> 日本語版: [README.ja.md](./README.ja.md)

# {{packageName}}

> [Pre-release / alpha] {{description}}

## Install

```bash
npm install {{packageName}}@alpha
```

## Configure

```typescript
// cms.config.ts
import { defineConfig } from 'ampless'
import {{nameCamelCase}}Plugin from '{{packageName}}'

export default defineConfig({
  // ...
  plugins: [
    {{nameCamelCase}}Plugin(),
  ],
})
```

Then go to `/admin/plugins` to configure.

## Trust level

`{{trustLevel}}`. Capabilities: `{{capabilitiesList}}`.

## Publishing

```bash
pnpm install
pnpm test
pnpm build
pnpm publish --access public --tag alpha
```

See the [ampless plugin author guide](https://github.com/heavymoons/ampless/blob/main/packages/ampless/docs/plugin-author-guide.md) for the full API.
