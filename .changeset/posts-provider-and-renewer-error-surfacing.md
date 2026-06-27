---
"@ampless/admin": patch
"@ampless/backend": patch
---

Stop silently swallowing failures on two server-side paths.

- admin `PostsProvider` read methods (`list`, `get`, `getById`) now check the AppSync `errors` array and throw — previously they destructured only `data`, so an authorization/resolver failure surfaced as an empty list or `null` instead of an error (matching the existing `listSummaries`/`create`/`update` behavior).
- backend `api-key-renewer` Lambda now wraps its handler in a top-level try/catch that logs with the `[api-key-renewer]` prefix and rethrows, so a failed scheduled run is visible in logs/alarms instead of an unprefixed unhandled rejection.
