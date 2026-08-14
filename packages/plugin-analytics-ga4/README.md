> 日本語版: [README.ja.md](./README.ja.md)
>

# @ampless/plugin-analytics-ga4

Google Analytics 4 plugin for [ampless](https://github.com/heavymoons/ampless).

> **Pre-release / beta.** Breaking changes are still possible before v1.0.

Drops the two standard GA4 snippets into every public page's `<head>` through the descriptor-based plugin head injection API ([plugin architecture](https://github.com/heavymoons/ampless/wiki/architecture-08-plugin-architecture)):

1. The async `gtag.js` loader (`https://www.googletagmanager.com/gtag/js?id=...`).
2. An inline `gtag('config', '<measurementId>')` bootstrap.

No AWS data permissions are required — everything runs at request time inside the public Next.js process. The plugin's `trust_level` is `untrusted`.

## Install

```bash
npm install @ampless/plugin-analytics-ga4@beta
```

## Configure

Register the plugin in `cms.config.ts`, then edit the live values from `/admin/plugins`. The constructor `measurementId` is an optional fallback for bootstrap and backwards compatibility:

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
| `measurementId` | `''` | Optional fallback GA4 measurement ID, e.g. `G-XXXXXXXX`. The admin-managed value wins at runtime. Set to `''` to disable the plugin without removing it from `cms.config.ts`. |
| `instanceId` | `'analytics-ga4'` | Namespace used for the script element ids. Set distinct values when registering multiple GA4 properties on the same site. |
| `consentCategory` | `''` | Optional consent category slug. When set, the GA4 loader fires only after `window.amplessConsent.has(<this>)` returns true. See [Consent gating](#consent-gating) below. |

## Consent gating

By default the GA4 loader fires on every page load regardless of visitor consent. To make it fire only after the visitor has granted consent, set `consentCategory` to a category slug and register `@ampless/plugin-cookie-consent` in the same `cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import cookieConsent from '@ampless/plugin-cookie-consent'
import analyticsGa4Plugin from '@ampless/plugin-analytics-ga4'

export default defineConfig({
  plugins: [
    // cookie-consent must appear before the analytics plugin
    cookieConsent({
      categories: [{ id: 'analytics', label: 'Analytics', defaultEnabled: false }],
    }),
    analyticsGa4Plugin({
      measurementId: 'G-XXXXXXXX',
      consentCategory: 'analytics',
    }),
  ],
})
```

When `consentCategory` is set the plugin switches to **gated mode**: instead of the two standard GA4 descriptors, it emits a single inline script that:

1. Checks `window.amplessConsent.has('analytics')` immediately (covers the case where consent was granted in a previous visit and restored from `localStorage`).
2. Otherwise subscribes to the consent event via `window.amplessConsent.on('analytics', ...)` and waits.
3. Also listens for `ampless:consent-ready` in case the analytics plugin loads before the cookie-consent plugin has installed its global API.

**Fail-closed contract:** if `consentCategory` is set but `@ampless/plugin-cookie-consent` is never registered, `window.amplessConsent` is never installed. GA4 will **never fire**, and after 5 seconds a `console.warn` appears:

```
[ampless:analytics-ga4] consentCategory is set but window.amplessConsent never installed.
Did you forget to register @ampless/plugin-cookie-consent?
```

This warning fires in production too — it is intended to help operators catch misconfiguration quickly. There is no mechanism to suppress it.

**Plugin ordering:** register `@ampless/plugin-cookie-consent` before the analytics plugin in the `plugins` array. The runtime processes plugins in order; placing cookie-consent first ensures `window.amplessConsent` is installed before the analytics gating logic runs.

For full details on the Consent Convention and the `window.amplessConsent` API see [architecture-08-plugin-architecture](https://github.com/heavymoons/ampless/wiki/architecture-08-plugin-architecture).

## Getting your measurement ID

1. Sign in to [Google Analytics](https://analytics.google.com/) and pick the property you want to install on the site.
2. Open **Admin → Data streams → Web** and select the stream for this site.
3. The page shows a `Measurement ID` of the form `G-XXXXXXXX`. Copy that value into the `measurementId` option above.

`G-XXXXXXXX` is safe to commit to source control — it identifies the property but does not authenticate writes.

## Multiple instances

The plugin contract supports multiple instances through distinct `instanceId` values. Use one instance per GA4 property:

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
- **Per-route event tagging** — Send any custom events from your own page code (`window.gtag('event', ...)`).
