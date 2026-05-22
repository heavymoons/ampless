---
"ampless": major
"@ampless/runtime": major
"@ampless/admin": major
"@ampless/backend": major
"@ampless/mcp-server": major
"create-ampless": major
---

Remove `siteId` from the AppSync data schema entirely.

The previous multi-site drop kept the column as `'default'` for
forward-compat. With this change, the field, identifier composite,
GSI key composition (siteIdStatus, siteIdSlug, siteIdTag), and
every consumer-side reference are gone.

**Breaking — destructive for existing deployments.** Amplify will
recreate the affected DynamoDB tables (Post, Page, Media, Taxonomy,
PostTag) on next sandbox / production deploy because the identifier
schema changes. **Existing post / media / page data will be lost.**
This is acceptable in v0.2 alpha (no production users yet).

What changed in the schema:

- Post: identifier `[postId]`, GSI `byStatus` (status, publishedAt)
  and `bySlug` (slug)
- Page / Media / Taxonomy: identifier dropped to just the resource
  id (`pageId` / `mediaId` / `termId`)
- PostTag: identifier `[tag, publishedAtPostId]`
- Custom queries (`listPublishedPosts`, `getPublishedPost`,
  `listPostsByTag`) lose their `siteId` argument
- JS resolvers in `templates/_shared/amplify/data/*.js` rewritten to
  query without the site partition prefix

Code-side changes:

- `ampless` no longer exports `DEFAULT_SITE_ID`,
  `composeSiteIdStatus`, `composeSiteIdSlug` (file `sites.ts`
  removed)
- `Post`, `Page`, `Media` types no longer carry `siteId`
- `ToolContext.defaultSiteId` removed from the MCP tool registry —
  tools' args no longer thread a site id at all
- `loadSiteSettings()` / `loadThemeConfig()` lose the (already
  optional) `siteId` parameter
- Admin page factories drop the `defaultSiteId` plumbing
- `processor-trusted` partition keys simplify from
  `${siteId}#published` to a single `published` query
- KvStore `siteconfig` PK is now a constant (no `:siteId` suffix);
  the S3 site-settings cache moves to `public/site-settings.json`

Migration:

1. On the next deploy (sandbox or production), Amplify will detect
   the identifier change and recreate the tables. **Back up
   anything you care about first.** For sandbox-only data, just let
   it rebuild.
2. Re-create your initial admin account after the redeploy if
   Cognito user data was tied to the wiped tables.

The retained `siteId` schema column is the last piece of the
multi-site removal that started in the previous commit on this
branch.
