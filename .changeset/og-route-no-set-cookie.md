---
"@ampless/runtime": patch
---

Public apiKey reads (post and media row lookups) now use a stateless Amplify server client (`generateServerClientUsingReqRes` run with `nextServerContext: null`) instead of the cookie-based client. This stops the runtime from writing a Cognito guest `identityId` `Set-Cookie` on public route responses (`/og/[slug]`, `/raw/[slug]`, `/feed.xml`, `/sitemap.xml`, public pages), which previously caused X/Twitter and other social crawlers to drop the OG image during link unfurling.
