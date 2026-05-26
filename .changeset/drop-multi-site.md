---
"ampless": minor
"@ampless/runtime": minor
"@ampless/admin": minor
"@ampless/backend": patch
"@ampless/mcp-server": minor
"create-ampless": minor
---

Drop in-deploy multi-site support. Single Amplify deployment = single site.

Why: Amplify Hosting's CloudFront cache key doesn't include Host, so
multi-site mode had to force `Cache-Control: private, no-store`,
killing edge caching for the most common (read) path. The
operator-facing cost (deploy separately per site, which everyone was
already doing) was lower than the perf cost. Single-site lets
CloudFront cache work out of the box.

What's removed (consumer-visible):

- `cms.config.sites: {...}` map → gone. Only `cms.config.site: {...}`
  (singular) is supported. Remove the `sites:` block from
  `cms.config.ts`; the `site:` block is unchanged.
- `Config.sites` and `SiteConfig` types removed from `ampless`. So are
  the `resolveSiteId`, `isMultiSite`, `siteFor` helpers.
- `<SiteSelector>` admin UI component, `/admin/sites/` list page,
  `admin-site-client.ts` cookie helpers (`ADMIN_SITE_COOKIE`,
  `readAdminSiteIdFromCookie`, `setAdminCmsConfig`).
- `admin.currentAdminSiteId()` / `admin.adminSiteOptions()` removed
  from the `Admin` shape.
- `loadSiteSettings(siteId)` / `loadThemeConfig(siteId)` — `siteId` arg
  is still accepted for API stability but ignored (always `'default'`).
- `createAmplessMiddleware` no longer reads `cmsConfig.sites` for
  host routing and no longer forces `Cache-Control: private, no-store`.
- MCP tools: the `siteId` argument is no longer advertised in tool
  schemas (LLM clients pass post args directly). Internal default-fallback
  is retained so older clients passing `siteId` still work.

What's NOT changing yet (deferred to follow-up PRs):

- URL structure — internal `/site/[siteId]/` (always `default`) is
  still in the routing tree. A follow-up flattens this to `/`-rooted
  paths.
- Cache-Control strategy — current responses are still mostly uncached.
  A follow-up introduces a cooldown-based CloudFront cache policy.

