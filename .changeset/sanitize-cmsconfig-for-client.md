---
"@ampless/admin": patch
---

Fix React Server Components serialization error when `cmsConfig.plugins` contained plugin instances (with non-serializable `hooks` functions).

Symptom from the dogfood site:

```
Runtime Error - Server

Functions cannot be passed directly to Client Components unless you
explicitly expose it by marking it with "use server". Or maybe you
meant to call this function rather than return it.

  {content.published: function rebuild, content.unpublished: ..., ...}
```

`createAdminLayout(admin)` passed `admin.cmsConfig` straight into the `<AdminProviders>` client component. Plugin instances in `cmsConfig.plugins` carry Lambda-side `hooks` (and `metadata`) functions that RSC's serializer cannot send across the server→client boundary.

Strip plugin instances down to `{ name, apiVersion, trust_level }` before passing — admin's client-side state modules only read `cmsConfig.site` / `cmsConfig.sites` / `cmsConfig.media`, never plugin hooks, so the reduction is safe.
