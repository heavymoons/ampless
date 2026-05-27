> 日本語版: [README.ja.md](./README.ja.md)
>

# @ampless/plugin-gtm

Google Tag Manager plugin for [ampless](https://github.com/heavymoons/ampless).

> **Pre-release / alpha.** Breaking changes possible in any minor version until v1.0.

Drops Google Tag Manager's standard two-part snippet onto every public page through the descriptor-based plugin head/body injection API:

1. The async loader inline `<script>` in `<head>`.
2. The matching `<noscript>` iframe at the end of `<body>`, so visitors with JavaScript disabled still register a pageview through GTM.

The container ID is **editable from `/admin/plugins`** after deploy — the constructor argument in `cms.config.ts` just seeds the initial default. No AWS data permissions are required; the plugin's `trust_level` is `untrusted` and everything runs at request time inside the public Next.js process.

## Install

```bash
npm install @ampless/plugin-gtm@alpha
```

## Configure

In `cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import gtmPlugin from '@ampless/plugin-gtm'

export default defineConfig({
  // ...
  plugins: [
    gtmPlugin({
      // Initial container ID. Editable from /admin/plugins after deploy.
      // Leave empty to ship the plugin disabled and turn it on later.
      containerId: '',
    }),
  ],
})
```

| Option | Default | Notes |
|---|---|---|
| `containerId` | `''` | Initial GTM container ID, e.g. `GTM-XXXXXXX`. Seeds the manifest default — the live value is read from `/admin/plugins` at request time. Set to `''` to ship the plugin disabled. |
| `instanceId` | `'gtm'` | Namespace used for the script / noscript element ids and the settings storage key. Set distinct values when registering multiple GTM containers on the same site. |

## Editing the container ID from the admin UI

After a deploy, the container ID lives at `/admin/plugins` → **Google Tag Manager**. Saving an empty value disables the plugin without removing it from `cms.config.ts`; saving `GTM-XXXXXXX` enables it. Changes are reflected on the public site after the site-settings S3 mirror finishes (a few seconds; the admin form delays the cache invalidation slightly so the rebuild has time to complete).

## Getting your container ID

1. Sign in to [Google Tag Manager](https://tagmanager.google.com/) and pick the workspace for the site.
2. The container ID (`GTM-XXXXXXX`) is shown in the top-right of the workspace UI.
3. Copy it into the `containerId` option above, or paste it into the admin form.

`GTM-XXXXXXX` is safe to commit to source control — it identifies the container but does not authenticate writes.

### A note on the ID pattern

The admin form validates the container ID against `^$|^GTM-[A-Z0-9]+$` — empty or the practical "starts with `GTM-`, then alphanumeric" shape. Google's [official install docs](https://support.google.com/tagmanager/answer/14847097) don't publish a strict format, so this is intentionally a loose sanity-check rather than a tight schema. If Google starts issuing a wider character set, file an issue and we'll widen the pattern.

## Multiple instances

Each `gtmPlugin(...)` call gets its own `instanceId` namespace, both in the rendered DOM and in the admin settings storage:

```ts
plugins: [
  gtmPlugin({ instanceId: 'marketing', containerId: 'GTM-AAA' }),
  gtmPlugin({ instanceId: 'product',   containerId: 'GTM-BBB' }),
]
```

The admin form lists each instance as its own panel.

## Trust level

`untrusted`. The plugin only contributes head and body descriptors that are validated and rendered by `@ampless/runtime`. It does not touch DynamoDB, S3, or any Lambda processor.

## What it does not do

- **CSP nonce propagation** — the inline loader script is emitted without a `nonce`. ampless sites don't enforce a CSP today; once that lands, a dedicated RFP will wire `nonce` end-to-end (middleware → SSR → descriptor).
- **GTM container imports** — this plugin only injects the loader. Tags / triggers / variables are configured inside the GTM web UI like any other site.
