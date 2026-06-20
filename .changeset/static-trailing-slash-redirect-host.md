---
"@ampless/runtime": patch
---

Fix the static-bundle trailing-slash redirect leaking the internal host. `/<slug>` (no trailing slash) 308-redirected to an absolute Location built from `request.url`, but under Amplify SSR / behind a proxy `request.url` reports the internal origin (`localhost:3000`), so visitors were bounced to `https://localhost:3000/<slug>/` — which also triggers Chrome's local-network-access permission prompt. The redirect now emits a host-relative `Location` (`/<slug>/`) so the browser resolves it against the public origin.
