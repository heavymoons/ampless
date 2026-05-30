> 日本語版: [README.ja.md](./README.ja.md)
>

# @ampless/plugin-cookie-consent

GDPR/ePrivacy cookie consent banner plugin for [ampless](https://github.com/heavymoons/ampless).

> **Pre-release / alpha.** Breaking changes possible in any minor version until v1.0.

Installs the `window.amplessConsent` Consent Convention API (§6 of the [plugin architecture docs](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md)) in every public page's `<head>`, then appends a configurable consent banner to `<body>` outside the React tree. Analytics and tracking plugins use the API to gate themselves until the visitor grants consent.

No AWS data permissions are required — everything runs at request time inside the public Next.js process. The plugin's `trust_level` is `untrusted`.

## Install

```bash
npm install @ampless/plugin-cookie-consent@alpha
```

## Configure

In `cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import cookieConsentPlugin from '@ampless/plugin-cookie-consent'

export default defineConfig({
  // ...
  plugins: [
    // List cookie-consent FIRST so its window.amplessConsent API is
    // available when subsequent analytics plugins initialise.
    cookieConsentPlugin(),
    // analyticsGa4Plugin({ ... }),  // PR D — coming soon
  ],
})
```

| Option | Default | Notes |
|---|---|---|
| `instanceId` | `'cookie-consent'` | Namespace used for script element ids. Change only if registering the plugin twice. |

## Settings (admin UI)

Configure from `/admin/plugins → Cookie Consent`:

| Key | Type | Default | Notes |
|---|---|---|---|
| `bannerText` | textarea | `'This site uses cookies…'` | Message shown at the top of the banner. |
| `acceptLabel` | text | `'Accept all'` | Label for the "accept all" button. |
| `rejectLabel` | text | `'Reject non-essential'` | Label for the "reject" button. |
| `position` | select | `'bottom'` | `'bottom'` / `'top'` / `'modal'`. |
| `categories` | repeatable | `[]` | List of consent categories. |

### Consent categories

Each category in the `categories` repeatable field has the following sub-fields:

| Sub-field | Type | Required | Notes |
|---|---|---|---|
| `id` | text | yes | Machine-readable, e.g. `'analytics'`. Pattern: `^[a-z][a-z0-9_-]*$`. |
| `label` | text | yes | Shown next to the checkbox in the banner. |
| `description` | textarea | no | Short description shown below the label. |
| `defaultEnabled` | boolean | no | Pre-check the toggle before the visitor makes a choice. |
| `essential` | boolean | no | Always granted; not shown as a toggle. Overrides `defaultEnabled`. |

Example configuration via the admin UI — add two categories:

```
id: analytics     label: Analytics
id: marketing     label: Marketing & personalisation
```

## Consent Convention

This plugin implements the ampless Consent Convention. Once installed, every page exposes:

```js
window.amplessConsent.has('analytics')  // → boolean
window.amplessConsent.on('analytics', function() { /* granted */ })  // returns unsubscribe fn
window.amplessConsent.set('analytics', true)  // called by banner UI
```

Standard events fired on `window`:

- `ampless:consent-ready` — fired once after the API is installed and localStorage is restored.
- `ampless:consent-changed` — fired on each `set()` call, `detail: { category, granted }`.

Consent state is persisted in `localStorage` under the key `'ampless:consent'` as a `Record<string, boolean>` JSON object.

For the full API specification and the analytics consume pattern see [`docs/architecture/08-plugin-architecture.md` — Consent Convention](https://github.com/heavymoons/ampless/blob/main/docs/architecture/08-plugin-architecture.md#consent-convention).

## Combining with analytics plugins (coming in PR D)

Once GA4, GTM, and Plausible plugins add `consentCategory` support (Phase 3b PR D), you can gate them like this:

```ts
plugins: [
  cookieConsentPlugin(),
  analyticsGa4Plugin({ measurementId: 'G-XXXXXXXX', consentCategory: 'analytics' }),
  gtmPlugin({ containerId: 'GTM-XXXXXXX', consentCategory: 'analytics' }),
]
```

With `consentCategory` set, the analytics plugin will not fire until the visitor grants consent for that category. If `window.amplessConsent` is not installed (i.e. `cookieConsentPlugin` is missing from `cms.config.ts`), tracking will **never fire** — this is the intended fail-closed design.

> **Note:** `consentCategory` support in GA4, GTM, and Plausible is implemented in Phase 3b PR D (not yet released).

## Trust level

`untrusted`. The plugin only emits inline script descriptors validated and rendered by `@ampless/runtime`. It does not access DynamoDB, S3, or any Lambda processor.

## What it does not do (v1)

- **Theme integration** — The banner style is light-theme fixed. Custom theming via CSS variables or a theme API is deferred until that capability surface exists.
- **GPC / DNT signal handling** — Global Privacy Control and Do Not Track signals are not automatically honoured; the operator must set default consent states accordingly.
- **Jurisdiction-aware defaults** — No automatic detection of visitor region (EU vs. non-EU) to adjust opt-in/opt-out defaults.
- **Granular sub-categories** — Each category is a flat boolean. Nested sub-categories are deferred.
- **Item reordering** — The admin `categories` repeatable supports add/remove but not drag-to-reorder in v1.
