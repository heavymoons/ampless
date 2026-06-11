> English: [README.md](./README.md)

# {{packageName}}

> [Pre-release / beta] {{description}}

## インストール

```bash
npm install {{packageName}}@beta
```

## 設定

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

`/admin/plugins` で設定。

## Trust level

`{{trustLevel}}`。Capabilities: `{{capabilitiesList}}`。

## Publish

```bash
pnpm install
pnpm test
pnpm build
pnpm publish --access public --tag beta
```

API 詳細は [ampless plugin author guide](https://github.com/heavymoons/ampless/blob/main/packages/ampless/docs/plugin-author-guide.md) を参照。
