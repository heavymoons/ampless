---
"@ampless/backend": minor
"@ampless/admin": minor
"create-ampless": minor
---

Auto-derive the WebAuthn relying-party ID from `cms.config.ts` `site.url` in Amplify Hosting pipeline builds, eliminating the most common RP-mismatch bug on custom domains. Sandboxes continue to use `localhost` auto-resolution.

The admin passkey UI (login button, account-page section) now mirrors the actual deployed state read from `amplify_outputs.json`: disabling passkeys via `webAuthn: false` in `resource.custom.ts` removes the UI entirely — no broken buttons or misleading prompts.

New export: `resolveWebAuthn({ override, siteUrl, isPipeline })` from `@ampless/backend`.
