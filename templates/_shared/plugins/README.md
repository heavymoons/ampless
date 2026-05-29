> 日本語版: [README.ja.md](./README.ja.md)

# Site-local plugins

This directory is for **plugins that belong only to this site** — small
customizations you don't want to publish as a separate npm package.

`update-ampless` never touches files in this directory, so anything you
add here is yours to keep.

## When to use a local plugin

Reach for a local plugin when you want a site-specific feature that:

- needs the plugin surface (`publicHead` / `publicBodyEnd` / `metadata` / `eventHooks` / etc.)
- is specific to this site (a one-off footer credit, a custom JSON-LD enrichment, an analytics snippet you're not yet ready to ship as a reusable package)
- you'd rather not version-bump or republish to iterate on

When the plugin grows useful for more than one site, lift it into its
own npm package (see `npx create-ampless plugin --standalone` once it
ships in Phase 5; for now you can copy it out by hand).

## Minimal example

`plugins/footer-credit/index.ts`:

```typescript
import { definePlugin, type AmplessPlugin } from 'ampless'

export interface FooterCreditOptions {
  instanceId?: string
}

export default function footerCreditPlugin(
  options: FooterCreditOptions = {}
): AmplessPlugin {
  const instanceId = options.instanceId ?? 'footer-credit'
  return definePlugin({
    name: 'footer-credit',
    instanceId,
    apiVersion: 1,
    trust_level: 'untrusted',
    displayName: { en: 'Footer credit', ja: 'フッタークレジット' },
    capabilities: ['publicBody', 'adminSettings'],
    settings: {
      public: [
        {
          type: 'text',
          key: 'html',
          label: { en: 'Snippet', ja: 'スニペット' },
          default: '',
        },
      ],
    },
    publicBodyEnd(ctx) {
      const html = (ctx.setting<string>('html') ?? '').trim()
      if (!html) return []
      return [{ type: 'noscript', id: `footer-credit-${instanceId}`, html }]
    },
  })
}
```

Register it in `cms.config.ts`:

```typescript
import footerCreditPlugin from './plugins/footer-credit'

export default defineConfig({
  // ...
  plugins: [
    // ...existing plugins...
    footerCreditPlugin(),
  ],
})
```

That's it. Restart `next dev` and visit `/admin/plugins` to configure
the snippet, then any public page renders it before `</body>`.

## What you can declare

A plugin is just an object built with `definePlugin({...})`. The full
shape lives in `node_modules/ampless/dist/plugin.d.ts` (or [the plugin
author guide][guide] if you prefer prose).

Capabilities currently active:

| capability | purpose |
|---|---|
| `publicHead` | descriptors rendered in `<head>` site-wide |
| `publicBody` | descriptors rendered before `</body>` site-wide |
| `metadata` | per-post Next.js Metadata contributions |
| `eventHooks` | trusted/untrusted background handlers (content lifecycle, media events, ...) |
| `adminSettings` | admin-editable settings declared via `settings.public[]` |
| `writePublicAsset` | trusted plugins can write namespaced files under `public/plugins/<instanceId>/...` |
| `schema` | per-post JSON-LD via `publicBodyForPost` (theme template must call `ampless.publicBodyForPost(post)`) |

[guide]: https://github.com/heavymoons/ampless/blob/main/packages/ampless/docs/plugin-author-guide.md

## What about TypeScript?

`tsconfig.json` already covers this directory through its `**/*.ts`
include glob. Both `import x from './plugins/foo'` and
`import x from '@/plugins/foo'` work; no extra setup needed.

## What `update-ampless` does

Nothing. `plugins/` is in the upgrade tool's protected list, so files
here are never overwritten or deleted on upgrade. The flip side is that
this README does not get refreshed either — when ampless ships
significant changes to the plugin API, check the [plugin author guide][guide]
in the canonical repo for the up-to-date version.
