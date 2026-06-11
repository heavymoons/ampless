> 日本語版: [14-roadmap.ja.md](./14-roadmap.ja.md)
> 
## 14. Roadmap

### Release Strategy

ampless follows a four-stage release path: **alpha → beta → RC → stable**.

- **alpha** (complete): closed development, repo private, npm `alpha` dist-tag, dogfood-driven feature work. Decisions were guided by "can I run my own multiple sites on ampless?"
- **beta** (current): repo is **public**, npm `beta` dist-tag. Breaking changes are still possible (called out via changesets), but external users can install and external plugin authors can publish.
- **RC**: feature-complete, no more breaking changes expected. Dogfood sites run on RC builds for the final-tuning period.
- **stable** (v1.0): public launch. The ampless introduction page (built with ampless itself) ships simultaneously.

v1.0 RC entry criteria (unchanged from the previous plan): (a) production-quality for the dogfood sites, and (b) the ampless-built introduction page is ready. Beta entry was handled through a private blocker checklist before public launch. Internal version numbers are bumped normally with changesets throughout all four stages.

WordPress compatibility scope is **WXR data import only**; plugin / theme / Gutenberg block compatibility is explicitly out of scope.

### Positioning (2026-06-07)

ampless is a customization-based CMS for engineers — non-engineers operate it with the polished admin. Plugins are npm dependencies that the site engineer imports + configures directly (Astro integration / Next.js plugin pattern); the engineer audits each dep before installing. The v1 trust framework (`trust_level`, capabilities, IAM-scoped Lambdas) is implemented as **first-party plugin organization** — which trust tier's Lambda runs each event hook, narrow hard gates such as `settings.secret` requiring `trust_level: 'trusted'`, and capability declarations supporting mismatch warnings + admin labels + future allow-lists. Not designed as a marketplace-grade automatic sandbox for arbitrary third-party untrusted plugins. Marketplace and runtime sandbox are deferred to v2.0+ exploration only, and only if AmpLess later needs to safely run plugins the engineer has not audited.

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
Phased work is summarized here; the public contract lives in [08-plugin-architecture.md](./08-plugin-architecture.md). Each phase ships at least one bundled plugin that exercises the new surface, then the next phase starts.

- [x] Phase 1: descriptor-based head/body injection + `capabilities` / `instanceId` / `displayName` on `AmplessPlugin`. First plugin: `@ampless/plugin-analytics-ga4` (settings via `cms.config.ts`). Contract: [08-plugin-architecture.md](./08-plugin-architecture.md)
- [x] Phase 2: admin-managed public settings (`/admin/plugins`, S3 cache mirror). GA4 settings migrate to the admin UI; new plugin author guide ships in `ampless` tarball + scaffold copy
- [x] Phase 3: trust-level dogfood. Phase 3a complete — `@ampless/plugin-gtm` + `@ampless/plugin-plausible` (untrusted) ship as new bundled plugins exercising the Phase 1/2 descriptor + admin-settings API. Phase 3c complete — `writePublicAsset` is formalised with runtime key validation + `instanceId ?? name` namespace enforcement, and existing `seo` / `rss` declare the new capability surface. Phase 3b complete — `PluginRepeatableField` (list-of-objects setting type) + `@ampless/plugin-cookie-consent` (untrusted) + Consent Convention regulation (`window.amplessConsent` global API + standard events), plus `consentCategory?: string` gated mode in GA4 / GTM / Plausible.
- [x] Phase 4: per-post body injection API (`publicBodyForPost`) + `schema` capability + JSON-LD auto-escape (`escapeJsonLdInlineBody`). First plugin: `@ampless/plugin-schema-jsonld` (untrusted). Theme post templates call `ampless.publicBodyForPost(post)` to render `<script type="application/ld+json">` elements.
- [x] Phase 5: external (out-of-monorepo) plugin npm-install proof — static `package.json#amplessPlugin` manifest convention + runtime cross-check, `npx create-ampless@beta plugin <name>` scaffold subcommand, plugin author guide rewrite, dogfooded with `@ishinao/ampless-plugin-site-verification` published to npm and consumed by ishinao.net
- [x] Phase 6d: `publicHtmlForPost` capability + `PublicPostHtmlDescriptor` type + `sanitize-html` sanitize layer in `@ampless/runtime`. First plugin: `@ampless/plugin-reading-time` (untrusted) — reading-time badge with English/CJK word count, admin-editable label template and position.
- [x] Phase 6a: `secretSettings` capability + `PluginSecretField` type (`default` stripped via `Omit` to prevent leakage) + `TrustedPluginRuntimeContext.secret<T>(key)` async accessor + `PluginSecret` DynamoDB model (admin/editor: write-only; IAM Lambda: read-only). `@ampless/plugin-webhook` retrofitted to `trust_level: 'trusted'` with admin-managed signing secret for zero-deploy key rotation.
- [x] Phase 7 (embed plugin extension): `contentFields` capability (promoted from reserved) + `publicPostScript` capability + `Ampless.renderBody(post): Promise<ReactNode>` (pre-1.0 breaking) + `renderBodyHtmlString` for raw-route compat + admin editor extension installer (`@ampless/admin/editor`) + iframe-srcDoc preview pipeline (Route Handler at `/admin/preview`, configurable via page factory `previewEndpoint` option). First plugins: `@ampless/plugin-youtube` + `@ampless/plugin-x-embed` (both `trusted`, served via `youtube-nocookie.com` and `platform.twitter.com/widgets.js`).
- [ ] Phase 6+ (each is its own RFP): developer-extension capabilities (`adminPage` / `serverRoute` / ...)

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

### Beta (current public pre-release)

Beta is the current public pre-release stage: the GitHub repo is browsable, packages publish under the npm `beta` dist-tag, and external users can install / external plugin authors can publish. Breaking changes are still possible (called out via changesets and dist-tag bumps); the contract becomes locked at RC.

Beta entry criteria are complete enough for public beta. Remaining hardening work stays in this roadmap and in ordinary GitHub issues.

---

### v1.0 RC (feature-complete phase)

**v1.0 scope criterion:** "Core + official plugins are sufficient to operate a site." The **extension surface** (plugin contract, `trust_level`, event infrastructure including the trusted / untrusted SQS + Lambda split, capability declarations, settings storage) is in place by v1.0 as **first-party plugin organization** — engineers declare their plugins' trust tier and capabilities, runtime routes event hooks to the matching Lambda. Narrow hard gates fire at specific points (most notably `settings.secret` requires `trust_level: 'trusted'` because secret read needs the trusted Lambda's IAM permission to the `PluginSecret` table); most capability declarations support mismatch warnings + admin labels + future allow-lists rather than hard gates. This surface is sized for first-party / engineer-audited npm deps. A marketplace-grade automatic sandbox that lets arbitrary untrusted third-party plugins run safely is **not** a v1.0 deliverable; that work is deferred to v2.0+ exploration.

Completion criteria:
- Multiple sites the maintainer wants to operate are running on ampless (dogfooded under load)
- The ampless introduction page (product page) is buildable with ampless (ready to ship at v1.0 stable)
- There is a clear path to running a blog with just `npx create-ampless@beta` + official plugins

Note: the **public-flip** to GitHub-public + npm `beta` dist-tag happens at the start of beta (one stage earlier than this RC). The **simultaneous introduction-page launch** happens at v1.0 stable (one stage later). See "Release Strategy" above for the four-stage breakdown.

---

### v1.0 Stable

The full public launch — the ampless introduction page (built with ampless) ships simultaneously with v1.0.

Core features still to be polished after stable:

- [ ] Admin UI completeness (user management, settings, media management UI)
- [ ] Custom content types (full implementation of `defineSchema`)
- [ ] REST API (read/write from external systems)
- [ ] eject support (switch themes to local copy)
- [ ] Documentation (external-facing Quick Start, Plugin author guide, Theme author guide)

---

### v2.0+ (exploration — not committed)

These items are **explored only if AmpLess later needs a plugin marketplace** (i.e., a path for safely running plugins the site engineer has not audited). They are NOT committed v2.0 deliverables; the v1.0 positioning (customization-based CMS for engineers; plugins are engineer-audited npm deps) does not require any of them.

#### Marketplace-grade sandbox exploration (only if a real plugin marketplace is built)
- [ ] Runtime-loaded third-party plugins (admin-UI install, S3 + dynamic loading)
- [ ] `privileged` plugin support (capabilities-based dynamic IAM provisioning per plugin)
- [ ] Plugin marketplace (API + Web UI)
- [ ] WASM / quickjs-emscripten runtime sandbox

#### General feature exploration (independent of trust)
- [ ] Git-free CMS updates from admin UI (engineer-side convenience)
- [ ] Multilingual content
- [ ] E-commerce support
