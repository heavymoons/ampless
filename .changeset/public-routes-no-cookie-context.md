---
"@ampless/admin": patch
"@ampless/runtime": patch
---

Public asset routes (`/api/media/[...path]`, static-bundle assets, and `streamS3ObjectWithRunner`) now run Amplify server operations with `nextServerContext: null` (the stateless guest path) instead of the visitor's cookie context. This guarantees these public-cacheable responses never read or write cookies, so a refreshed admin/editor token can no longer surface as `Set-Cookie` on a cacheable response.
