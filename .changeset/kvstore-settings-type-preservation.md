---
'@ampless/backend': patch
'@ampless/runtime': patch
'ampless': patch
---

Fix a site-wide 500 when a site setting value is a numeric-looking string (e.g. a site name of `"1470"`).

**Root cause** — `a.json()` (AWSJSON) fields are stored in DynamoDB as their *native* types (string→S, number→N, boolean→BOOL, object→M). The trusted event processor reads them via `DynamoDBDocumentClient`, which already unmarshals them back to native JS values, so the value is correctly typed at that point. The cache rebuild (and the published-post lister) nonetheless ran `JSON.parse` over string values, **double-decoding** anything that looked like JSON — `"1470"` became the number `1470`. A numeric site name then flowed into Next.js metadata, whose `resolveTitle` runs `'template' in title` and throws `TypeError: Cannot use 'in' operator …` for a non-string title, 500-ing every public page.

**`@ampless/backend`** — `rebuildSiteSettingsCache` and `listPublished` no longer re-parse `DynamoDBDocumentClient` values; the already-native value is used as-is, preserving the type of every setting and post body. The misnamed `safeParse` helper is removed. Rebuild failures now log with a stable `[trusted-processor][ALERT]` marker (keeping the full error/stack) and still re-throw to the DLQ retry path. The S3 resource ARNs granted to the trusted processor are extracted into `siteSettingsCacheS3Resources()` with a unit test guarding the exact-match `public/site-settings.json` key (a wildcard would silently `AccessDenied`).

**`@ampless/runtime`** — defense-in-depth so a single bad value can never 500 the whole site: `loadSiteSettings` coerces `site.name` / `site.url` / `site.description` with `String()`, and `seo.siteMetadata` coerces the metadata `title` to a string.

**`ampless`** — the AWSJSON helper documentation now spells out that `decodeAwsJson` is only for GraphQL-wire reads; values read directly via `DynamoDBDocumentClient` are already native and must not be decoded (decoding a native scalar string double-decodes it).

No data migration is required: DynamoDB stored the values with correct native types all along — only the derived `public/site-settings.json` cache was wrong, and it self-heals on the next rebuild.
