---
"create-ampless": patch
---

Fix `Cannot access 'ampless' before initialization` ReferenceError that crashed scaffolded sites at request time.

The back-compat shims in `templates/_shared/lib/{posts-public,site-settings,seo,storage,theme-active,theme-config,admin-site,auth-server}.ts` used `ampless.X.bind(ampless)` / `admin.X.bind(admin)` to re-export methods. That eagerly reads the `ampless` (or `admin`) binding at module evaluation, which loses against the circular import chain:

```
lib/ampless.ts
  → ../themes-registry
    → ../themes/<name>/index.ts
      → ../themes/<name>/pages/home.tsx
        → @/lib/posts-public  (the shim)
          → @/lib/ampless     ← still in TDZ here
```

Replaced every `.bind(X)` with an arrow function wrapper (`(...args) => X.method(...args)`) so the binding is read at call time instead. Existing scaffolds need to apply the same edit to their `lib/*.ts` files (or copy from the updated templates).

Discovered when sandbox-deploying the first dogfood site against alpha.1.
