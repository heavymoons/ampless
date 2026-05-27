> 日本語版: [README.ja.md](./README.ja.md)
>

# @ampless/plugin-analytics-ga4

Google Analytics 4 plugin for [ampless](https://github.com/heavymoons/ampless).

> **Pre-release / alpha.** Breaking changes possible in any minor version until v1.0.

Drops the two standard GA4 snippets into every public page's `<head>` through the descriptor-based plugin head injection API ([docs/tmp/plugin-extension-spec.md](https://github.com/heavymoons/ampless/blob/main/docs/tmp/plugin-extension-spec.md), Phase 1):

1. The async `gtag.js` loader (`https://www.googletagmanager.com/gtag/js?id=...`).
2. An inline `gtag('config', '<measurementId>')` bootstrap.

No AWS data permissions are required — everything runs at request time inside the public Next.js process. The plugin's `trust_level` is `untrusted`.

## Install

```bash
npm install @ampless/plugin-analytics-ga4@alpha
```

## Configure

In `cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import analyticsGa4Plugin from '@ampless/plugin-analytics-ga4'

export default defineConfig({
  // ...
  plugins: [
    analyticsGa4Plugin({ measurementId: 'G-XXXXXXXX' }),
  ],
})
```

| Option | Default | Notes |
|---|---|---|
| `measurementId` | required | Your GA4 measurement ID, e.g. `G-XXXXXXXX`. Set to `''` to disable the plugin without removing it from `cms.config.ts`. |
| `instanceId` | `'analytics-ga4'` | Namespace used for the script element ids. Set distinct values when registering multiple GA4 properties on the same site. |

## Getting your measurement ID

1. Sign in to [Google Analytics](https://analytics.google.com/) and pick the property you want to install on the site.
2. Open **Admin → Data streams → Web** and select the stream for this site.
3. The page shows a `Measurement ID` of the form `G-XXXXXXXX`. Copy that value into the `measurementId` option above.

`G-XXXXXXXX` is safe to commit to source control — it identifies the property but does not authenticate writes.

## Multiple instances

Phase 1 ships the type definitions for multi-instance plugins, but full runtime validation lands in Phase 3 ([docs/tmp/plugin-extension-roadmap.md](https://github.com/heavymoons/ampless/blob/main/docs/tmp/plugin-extension-roadmap.md)). The shape today:

```ts
plugins: [
  analyticsGa4Plugin({ instanceId: 'marketing', measurementId: 'G-AAA' }),
  analyticsGa4Plugin({ instanceId: 'product',   measurementId: 'G-BBB' }),
]
```

## Trust level

`untrusted`. The plugin only contributes head descriptors that are validated and rendered by `@ampless/runtime`. It does not touch DynamoDB, S3, or any Lambda processor.

## What it does not do (yet)

- **CSP nonce propagation** — Phase 1 emits the inline script without a `nonce`. ampless sites do not enforce a CSP today; once that lands, a dedicated RFP will wire `nonce` end-to-end (middleware → SSR → descriptor).
- **Admin UI settings** — Phase 1 reads the measurement ID from `cms.config.ts` only. Admin-managed settings come in Phase 2.
- **Per-route event tagging** — Send any custom events from your own page code (`window.gtag('event', ...)`).
