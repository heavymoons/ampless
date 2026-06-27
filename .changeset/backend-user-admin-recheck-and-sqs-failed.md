---
"@ampless/backend": patch
---

Harden two server-side paths.

- `user-admin` Lambda (`listAdminUsers` / `setAdminUserRole`) now re-checks the caller's Cognito group (`ampless-admin`) inside the handler, mirroring `plugin-secret-handler`. AppSync already gates these ops at the schema level, but the in-handler check makes the Lambda safe if it is ever invoked directly (e.g. an IAM policy that bypasses AppSync).
- The stream dispatcher's `sendBatch` now inspects the `SendMessageBatch` response and throws on partial failures (`Failed` entries). Previously the response was discarded, so individual messages that failed to enqueue were silently dropped instead of triggering a stream retry.
