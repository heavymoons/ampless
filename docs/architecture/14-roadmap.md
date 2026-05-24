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

### v0.1 (done — internal release)

- [x] CLI wizard (`npx create-ampless@latest`)
- [x] Core library (content CRUD, plugin contract, shared utilities)
- [x] Admin UI (content CRUD, tiptap editor, media upload)
- [x] Blog theme (`templates/blog`)
- [x] Cognito auth (email + password, forgot-password flow)
- [x] MCP Server (`@ampless/mcp-server`, stdio transport, Cognito SRP authn, 7 tools)
- [x] Core plugins: SEO (sitemap.xml + OGP), RSS (feed.xml), Webhook (HMAC-signed POST)
- [x] trust_level Lambda infrastructure (untrusted / trusted, DynamoDB Streams → SQS)
- [x] AppSync API key auto-renewal job (monthly EventBridge → UpdateApiKey)
- [x] editor trust model specified (`unfiltered_html`-like)

---

### v0.x (in progress — accumulated through dogfooding)

Features needed to run dogfood sites on ampless, in priority order. Each changesets cut at a granular level, bumped from v0.x → v0.(x+1) when a meaningful unit is ready.

#### Single-site model + edge caching (top priority)
- [x] Drop in-deploy multi-site support. One Amplify deployment = one site
- [x] Flatten internal routing tree to root-relative paths
- [ ] CloudFront cache strategy: emit `Cache-Control: public, s-maxage=...` on SSR responses to leverage CloudFront caching → reduce Lambda invocations (Amplify Hosting's internal CloudFront doesn't include Host in the cache key and users cannot modify Cache Policy / Lambda@Edge, so the cleanest path is to make every deployment serve a single site)
- [ ] Amplify Hosting custom domain operations guide (DNS / SSL / adding separate domain procedure)

#### Themes / Visual Customization
- [ ] Lightweight customization via `configSchema` (primaryColor, font, logo, sidebar toggle)
- [ ] Additional themes (landing page, portfolio, documentation site)
- [ ] **`@ampless/theme-dads`** — A theme conforming to the Digital Agency Design System (DADS). Combines `@digital-go-jp/tailwind-theme-plugin` (MIT, officially Tailwind v4 compatible) with MIT React sample components to deliver a theme that serves layout and content in full DADS specification. Intended for Japanese, government, and public-sector site scenarios
- [ ] Theme switching + iframe preview (in admin UI)

#### MCP / AI Integration
- [ ] MCP HTTP transport (standard practice of pasting a PAT into `.mcp.json`)
- [ ] MCP access token issuance UI (admin panel)
- [ ] AI provider abstraction layer
- [ ] Proofreading / summarization plugins

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
