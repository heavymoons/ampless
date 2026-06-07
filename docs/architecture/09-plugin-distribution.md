> 日本語版: [09-plugin-distribution.ja.md](./09-plugin-distribution.ja.md)
> 
## 9. Plugin Distribution and Installation

### Build-time Installation (current model)

Plugins are distributed as npm packages and bundled into the deployed Lambda artifacts at build time. Activation is a single line in the project's `cms.config.ts`:

```bash
pnpm add @ampless/plugin-seo @ampless/plugin-rss
```

```typescript
// cms.config.ts
import { defineConfig } from 'ampless'
import seoPlugin from '@ampless/plugin-seo'
import rssPlugin from '@ampless/plugin-rss'

export default defineConfig({
  site: { name: '...', url: '...' },
  plugins: [
    seoPlugin({ /* ... */ }),
    rssPlugin({ /* ... */ }),
  ],
})
```

A subsequent `git push` triggers Amplify Hosting's auto-build and deploys the updated Lambdas. The trusted / untrusted Lambdas each filter `plugins` down to their own `trust_level` and bind the matching event hooks at handler init.

**Implications**

- npm version management, lockfiles, and security auditing apply unchanged.
- Adding or removing a plugin requires redeploying the site.
- Non-developer install (admin UI "click to install") is not possible in this model — installing is a code change.

The trade-off is deliberate: ampless's target is engineer-customized sites where plugin installation is a code/deploy step — the engineer audits the npm dep before installing, and a CDK redeploy is acceptable. The alternative (loading arbitrary JS at runtime from admin UI) is a much larger sandbox-design problem, deferred to v2.0+ exploration.

### First-party plugins

Shipped from this monorepo, published under `@ampless/` on npm:

- `@ampless/plugin-seo` — per-post and site-level SEO metadata. trusted.
- `@ampless/plugin-rss` — generates `public/plugins/rss/feed.xml` on content publish. trusted.
- `@ampless/plugin-og-image` — dynamic OG-image rendering at request time. untrusted (renders inside the public Next.js process, no AWS data permissions needed).
- `@ampless/plugin-webhook` — outbound webhook delivery on content events. trusted. Uses the `secretSettings` capability (Phase 6a) to store the HMAC signing secret in the admin UI, enabling zero-deploy key rotation across all endpoints.
- `@ampless/plugin-analytics-ga4` — Google Analytics 4 head injection via the descriptor API + admin-managed settings. untrusted (runs inside the public Next.js process, no AWS data permissions needed).
- `@ampless/plugin-gtm` — Google Tag Manager head + body injection (loader script in `<head>`, `<noscript>` iframe fallback at end of `<body>`) with the container ID editable from `/admin/plugins`. untrusted.
- `@ampless/plugin-plausible` — Plausible Analytics head injection (privacy-focused, cookie-free). Site domain + script URL editable from `/admin/plugins`; `scriptUrl` defaults to the hosted plausible.io but can be overridden for self-hosted installs. untrusted.
- `@ampless/plugin-schema-jsonld` — per-post Article / structured-data JSON-LD via `publicBodyForPost`. The theme's post page template calls `ampless.publicBodyForPost(post)` and injects the returned `<script type="application/ld+json">` element. untrusted. (Phase 4)
- `@ampless/plugin-cookie-consent` — GDPR/ePrivacy cookie consent banner. Installs the `window.amplessConsent` Consent Convention API (`has` / `isSet` / `on` / `set` + the `ampless:consent-ready` / `ampless:consent-changed` events) so other plugins can gate themselves on user consent. Configures categories via the `PluginRepeatableField` setting type. The GA4 / GTM / Plausible plugins each support a `consentCategory?: string` option that switches them into a gated mode (single inlineScript that defers loading until consent is granted). untrusted. (Phase 3b)
- `@ampless/plugin-reading-time` — reading-time badge via `publicHtmlForPost` (Phase 6d). Estimates read time from the post body (English word count + CJK character count ÷ 2) and injects a `<p class="ampless-reading-time">` element before or after the post content. Label template, WPM, and position are admin-editable. untrusted. (Phase 6d)

The first-party set is being expanded along the plugin extension roadmap ([docs/tmp/plugin-extension-roadmap.md](../tmp/plugin-extension-roadmap.md)). Future additions also exercise the descriptor-based head/body injection API ([docs/tmp/plugin-extension-spec.md](../tmp/plugin-extension-spec.md)).

The existing `seo` / `rss` plugins migrate to the new capability + descriptor surface in Phase 3c ([docs/tmp/plugin-trust-levels-rfp.md](../tmp/plugin-trust-levels-rfp.md), pending) while keeping their existing behaviour as backward-compatible defaults.

### Runtime / marketplace installation

Admin-UI-driven install (upload bundle → fetch from S3 → execute in Lambda at runtime) is **not implemented**. The sandbox story for "load arbitrary JS into a trusted Lambda at runtime" is the open question: doing it inside a shared trusted Lambda is unacceptable, doing it in a per-plugin Lambda requires capability-based dynamic IAM. That work sits on the [roadmap](./14-roadmap.md) and is explicitly not a v1.0 deliverable.

Until that lands, third-party plugins distribute the same way first-party ones do: as npm packages that the site operator adds to their own repo.

---
