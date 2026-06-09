---
"@ampless/admin": patch
"ampless": patch
"create-ampless": patch
---

Relax the admin preview iframe sandbox from `allow-scripts` to
`allow-scripts allow-same-origin`, **and explicitly extend ampless v1's
trust boundary to include admin preview content / plugin script**.

Third-party embed widgets (YouTube SDK, x.com `widgets.js`, etc.)
refuse to initialise inside an opaque-origin (`allow-scripts`-only)
iframe — they need access to non-HttpOnly storage / cache and
real-origin requests (an opaque-origin iframe blocks them outright;
with a real origin the iframe can use non-opaque-origin storage / cache
and issue eligible credentialed XHR — subject to browser settings and
third-party cookie restrictions). With `srcDoc` + `allow-same-origin`,
the iframe inherits the admin's origin and widgets hydrate.

**Important — this is a trust boundary change, not just a sandbox
relax**: preview iframe script gets near-direct access to the admin's
DOM / API. PostHistoryPanel can show a different editor's past
revision (= body author ≠ preview viewer), and `publicPostScript`
allows declaring scripts from external hosts. v1 explicitly chooses
to trust both: the engineer audits their plugins before installing,
so admin preview content / plugin script is in the same trust ring
as the cms config itself. The safer alternative — separate-origin
preview route + CSP / COEP / COOP — is parked for v2.0+ if/when a
real plugin marketplace lands.

`ampless` patch covers the architecture doc + plugin-author-guide
updates that explicitly document this new trust boundary (both ship
in the published tarball via the `files` allowlist).
`create-ampless` patch covers the matching template scaffold updates
(`app/(admin)/admin/preview/route.tsx` comments + author guide mirror).
