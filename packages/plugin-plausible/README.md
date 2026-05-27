> 日本語版: [README.ja.md](./README.ja.md)
>

# @ampless/plugin-plausible

[Plausible Analytics](https://plausible.io/) plugin for [ampless](https://github.com/heavymoons/ampless).

> **Pre-release / alpha.** Breaking changes possible in any minor version until v1.0.

Drops the standard Plausible `<script>` snippet onto every public page through the descriptor-based plugin head injection API. Plausible is a privacy-focused, cookie-free analytics service — most deployments don't need a cookie-consent banner to use it.

The site domain and the script URL are both **editable from `/admin/plugins`** after deploy. The constructor arguments in `cms.config.ts` just seed the initial defaults. No AWS data permissions are required; the plugin's `trust_level` is `untrusted` and everything runs at request time inside the public Next.js process.

## Install

```bash
npm install @ampless/plugin-plausible@alpha
```

## Configure

In `cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import plausiblePlugin from '@ampless/plugin-plausible'

export default defineConfig({
  // ...
  plugins: [
    plausiblePlugin({
      // Initial site domain (matches what's registered in Plausible).
      // Editable from /admin/plugins after deploy. Leave empty to ship
      // the plugin disabled and turn it on later.
      domain: '',
    }),
  ],
})
```

| Option | Default | Notes |
|---|---|---|
| `domain` | `''` | Initial Plausible site domain, e.g. `example.com`. Must match the value registered in the Plausible dashboard exactly — a mismatch silently drops every pageview. Set to `''` to ship the plugin disabled. |
| `scriptUrl` | `'https://plausible.io/js/script.js'` | URL of the Plausible script. Override for self-hosted Plausible (e.g. `'https://analytics.example.com/js/script.js'`). The admin field is **required**, so the value can't be cleared — to switch back to the hosted plausible.io URL, use **Reset to default** in the admin form. |
| `instanceId` | `'plausible'` | Namespace used for the script element id and settings storage key. Set distinct values when registering multiple Plausible sites on the same deployment. |

## Editing settings from the admin UI

After a deploy, both fields live at `/admin/plugins` → **Plausible Analytics**.

- **Site domain** — saving an empty value disables the plugin without removing it from `cms.config.ts`; saving `example.com` enables it.
- **Script URL** — required, defaults to `https://plausible.io/js/script.js`. Override to point at a self-hosted Plausible install. The field cannot be cleared (`required: true`); use **Reset to default** in the admin form to switch back to the hosted plausible.io URL.

Changes are reflected on the public site after the site-settings S3 mirror finishes (a few seconds).

## Registering your domain with Plausible

1. Sign in to your [Plausible dashboard](https://plausible.io/sites) (or your self-hosted Plausible instance).
2. **Add site** and enter the same domain you'll configure here — e.g. `example.com`. Plausible matches on the exact registered string when ingesting events, so the value in the admin form must match the dashboard value character-for-character.
3. Copy the domain into the `domain` option above, or paste it into the admin form.

The domain string is safe to commit to source control — it's just the site identifier and doesn't authenticate writes.

## Self-hosted Plausible

[Plausible Community Edition](https://github.com/plausible/community-edition) self-hosts on your own infrastructure. To point this plugin at a self-hosted instance, override `scriptUrl` from the admin form (or from `cms.config.ts` for the initial default):

```ts
plausiblePlugin({
  domain: 'example.com',
  scriptUrl: 'https://analytics.example.com/js/script.js',
})
```

To revert to the hosted plausible.io URL, click **Reset to default** in the admin form — that deletes the stored DDB row so the next request falls back to the manifest default.

## Multiple instances

Each `plausiblePlugin(...)` call gets its own `instanceId` namespace, both in the rendered DOM and in the admin settings storage:

```ts
plugins: [
  plausiblePlugin({ instanceId: 'marketing', domain: 'marketing.example.com' }),
  plausiblePlugin({ instanceId: 'product',   domain: 'app.example.com' }),
]
```

The admin form lists each instance as its own panel.

## Trust level

`untrusted`. The plugin only contributes a head descriptor that is validated and rendered by `@ampless/runtime`. It does not touch DynamoDB, S3, or any Lambda processor.

## What it does not do

- **CSP nonce propagation** — the script descriptor is emitted without a `nonce`. ampless sites don't enforce a CSP today; once that lands, a dedicated RFP will wire `nonce` end-to-end (middleware → SSR → descriptor).
- **Plausible custom events** — the loader is injected; custom events fire from your own page code via the standard Plausible `window.plausible(...)` API.
