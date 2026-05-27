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

The trade-off is deliberate: ampless's target is dogfood-grade sites operated by their owner, where a CDK redeploy is acceptable and the alternative (loading arbitrary JS at runtime) is a much larger sandbox-design problem.

### First-party plugins

Shipped from this monorepo, published under `@ampless/` on npm:

- `@ampless/plugin-seo` — per-post and site-level SEO metadata. trusted.
- `@ampless/plugin-rss` — generates `public/plugins/rss/feed.xml` on content publish. trusted.
- `@ampless/plugin-og-image` — dynamic OG-image rendering at request time. untrusted (renders inside the public Next.js process, no AWS data permissions needed).
- `@ampless/plugin-webhook` — outbound webhook delivery on content events. untrusted.
- `@ampless/plugin-analytics-ga4` — Google Analytics 4 head injection via the Phase 1 descriptor API. untrusted (runs inside the public Next.js process, no AWS data permissions needed).

The first-party set is being expanded along the plugin extension roadmap ([docs/tmp/plugin-extension-roadmap.md](../tmp/plugin-extension-roadmap.md)). Future additions also exercise the descriptor-based head/body injection API ([docs/tmp/plugin-extension-spec.md](../tmp/plugin-extension-spec.md)):

- `@ampless/plugin-gtm` — Google Tag Manager (untrusted, Phase 3).
- `@ampless/plugin-plausible`, `@ampless/plugin-cookie-consent`, etc. — Phase 3 dogfood candidates.

The existing `seo` / `rss` plugins migrate to the new capability + descriptor surface in Phase 3 ([docs/tmp/plugin-trust-levels-rfp.md](../tmp/plugin-trust-levels-rfp.md), pending) while keeping their existing behaviour as backward-compatible defaults.

### Runtime / marketplace installation

Admin-UI-driven install (upload bundle → fetch from S3 → execute in Lambda at runtime) is **not implemented**. The sandbox story for "load arbitrary JS into a trusted Lambda at runtime" is the open question: doing it inside a shared trusted Lambda is unacceptable, doing it in a per-plugin Lambda requires capability-based dynamic IAM. That work sits on the [roadmap](./14-roadmap.md) and is explicitly not a v1.0 deliverable.

Until that lands, third-party plugins distribute the same way first-party ones do: as npm packages that the site operator adds to their own repo.

---
