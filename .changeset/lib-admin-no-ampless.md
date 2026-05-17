---
"create-ampless": patch
---

Fix second TDZ trap: `lib/admin.ts` was passing the `ampless` runtime instance to `createAdmin`, which read the binding eagerly at module init. Under the circular chain (`lib/ampless.ts` → themes-registry → theme pages → `lib/i18n.ts` → `lib/admin.ts`), `ampless` is still in its TDZ when admin.ts evaluates and crashes.

Dropped the `ampless` parameter from the `createAdmin` call in `templates/_shared/lib/admin.ts`. `createAdmin` builds its own internal runtime instance when omitted (per L2's optional-param design), which is functionally equivalent for admin's needs — admin manages content and doesn't render themed pages, so it doesn't need theme resolution from the public-side ampless.

Also defensively wrapped `templates/_shared/lib/i18n.ts`'s `export const t = admin.t` in an arrow function so future circular paths through i18n don't reintroduce a TDZ.

Existing scaffolds need to copy these two edits over from the updated templates.
