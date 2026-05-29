> 日本語版: [14-roadmap.ja.md](./14-roadmap.ja.md)
> 
## 14. Roadmap

### Release Strategy

ampless is developed **in private until it reaches v1.0 RC**.

- Development decisions are guided by "can I run my own multiple sites on ampless?" (dogfooding first)
- v1.0 RC is triggered by meeting **both**: **(a)** production-quality for the dogfood sites, and **(b)** an ampless-built introductory page is ready
- At that point: make the GitHub repo public, `pnpm release` to npm publish, and launch the introductory page simultaneously
- Until then: no investment in external-user README / Quick Start / marketing copy; focus on core features + documentation (design docs)
- Internal version numbers continue to be bumped normally with changesets (versioning is continuous even while unpublished)

WordPress compatibility scope is **WXR data import only**; plugin / theme / Gutenberg block compatibility is explicitly out of scope.

---

### v0.x (in progress — accumulated through dogfooding)

Features needed to run dogfood sites on ampless, in priority order. Each changesets cut at a granular level, bumped from v0.x → v0.(x+1) when a meaningful unit is ready.

#### Single-site model + edge caching (top priority)
- [x] CloudFront cache strategy for **asset bytes**: `/api/media/...` and static-bundle `/<slug>/<path>` routes stream the S3 object back through the Lambda response (instead of 302-redirecting to a presigned URL) so Amplify Hosting's CloudFront edge cache absorbs repeat reads. Files larger than 6 MB still fall back to the 302 presigned path. Asset metadata (size, mimeType) is persisted in the Media DynamoDB row + `post.metadata.files` so the read path skips a HEAD round-trip.
- [ ] CloudFront cache strategy for **themed post HTML responses**: emit `Cache-Control: public, s-maxage=...` on SSR responses to leverage CloudFront caching → reduce Lambda invocations (Amplify Hosting's internal CloudFront doesn't include Host in the cache key and users cannot modify Cache Policy / Lambda@Edge, so the cleanest path is to make every deployment serve a single site)
- [ ] Amplify Hosting custom domain operations guide (DNS / SSL / adding separate domain procedure)

#### Themes / Visual Customization
- [ ] Lightweight customization via `configSchema` (primaryColor, font, logo, sidebar toggle)
- [ ] Additional themes (landing page, portfolio, documentation site)
- [ ] **`@ampless/theme-dads`** — A theme conforming to the Digital Agency Design System (DADS). Combines `@digital-go-jp/tailwind-theme-plugin` (MIT, officially Tailwind v4 compatible) with MIT React sample components to deliver a theme that serves layout and content in full DADS specification. Intended for Japanese, government, and public-sector site scenarios
- [ ] Theme switching + iframe preview (in admin UI)

#### MCP / AI Integration
- [ ] AI provider abstraction layer
- [ ] Proofreading / summarization plugins

#### Plugin Extension (dogfood-driven, phased)
Phased work tracked in [docs/tmp/plugin-extension-roadmap.md](../tmp/plugin-extension-roadmap.md). Each phase ships at least one bundled plugin that exercises the new surface, then the next phase starts.

- [x] Phase 1: descriptor-based head/body injection + `capabilities` / `instanceId` / `displayName` on `AmplessPlugin`. First plugin: `@ampless/plugin-analytics-ga4` (settings via `cms.config.ts`). Spec: [docs/tmp/plugin-extension-spec.md](../tmp/plugin-extension-spec.md)
- [x] Phase 2: admin-managed public settings (`/admin/plugins`, S3 cache mirror). GA4 settings migrate to the admin UI; new plugin author guide ships in `ampless` tarball + scaffold copy
- [x] Phase 3: trust-level dogfood. Phase 3a complete — `@ampless/plugin-gtm` + `@ampless/plugin-plausible` (untrusted) ship as new bundled plugins exercising the Phase 1/2 descriptor + admin-settings API. Phase 3c complete — `writePublicAsset` is formalised with runtime key validation + `instanceId ?? name` namespace enforcement, and existing `seo` / `rss` declare the new capability surface. Phase 3b (cookie-consent + `PluginRepeatableField`) remains deferred until a real cookie-consent need appears
- [x] Phase 4: per-post body injection API (`publicBodyForPost`) + `schema` capability + JSON-LD auto-escape (`escapeJsonLdInlineBody`). First plugin: `@ampless/plugin-schema-jsonld` (untrusted). Theme post templates call `ampless.publicBodyForPost(post)` to render `<script type="application/ld+json">` elements.
- [ ] Phase 5: external (out-of-monorepo) plugin npm-install proof
- [ ] Phase 6+ (each is its own RFP): secret settings storage, developer-extension capabilities (`adminPage` / `serverRoute` / `contentFields` / ...)

#### Content
- [ ] Markdown / HTML canonical support (first-class treatment of non-tiptap formats in editing)
- [ ] before hooks (validation / rewriting by plugins)
- [ ] Media events (`media.uploaded` / `media.deleted` processing path)

#### Operational Quality
- [ ] CloudWatch dashboard auto-generation
- [ ] DLQ alarm
- [ ] Cognito User Pool production SES configuration guide + automated setup

#### Migration Tools (when needed)
- [ ] WXR import (migrate posts / media from WordPress)

If dogfood targets include existing WordPress sites, the priority of this item increases. For new sites only, it can be addressed in the buffer period just before v1.0 RC.

---

### v1.0 RC (public release trigger)

**v1.0 scope criterion:** "Core + official plugins are sufficient to operate a site." The **extension surface** (plugin contract, trust_level, event infrastructure) is in place by v1.0, but the distribution mechanism / marketplace / dynamic plugin loading itself is not implemented in v1.0 (to avoid the WordPress dynamic where plugins are required just to get started).

Completion criteria:
- Multiple sites I want to operate are running on ampless
- The ampless introduction page (product page) is built with ampless
- There is a clear path to running a blog with just `npx create-ampless@latest` + official plugins

At this point:
- Make the GitHub repo public
- `pnpm release` to npm publish all packages
- Launch the introduction page simultaneously

---

### v1.0 Stable (post-release)

Core features still to be polished after the public release:

- [ ] Admin UI completeness (user management, settings, media management UI)
- [ ] Custom content types (full implementation of `defineSchema`)
- [ ] REST API (read/write from external systems)
- [ ] eject support (switch themes to local copy)
- [ ] Documentation (external-facing Quick Start, Plugin author guide, Theme author guide)

---

### v2.0+ (extensions and future vision)

Third-party extension ecosystem features. **Design room** is baked in by v1.0, but implementation is deferred to v2.0+:

- [ ] Third-party plugins (S3 + runtime loading)
- [ ] privileged plugin support (capabilities-based dynamic IAM)
- [ ] Plugin marketplace (API + Web UI)
- [ ] quickjs-emscripten runtime sandbox
- [ ] Git-free CMS updates from admin UI
- [ ] Multilingual content
- [ ] E-commerce support
