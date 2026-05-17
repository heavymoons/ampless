---
"create-ampless": patch
"@ampless/runtime": patch
---

Inline the proxy matcher config in scaffolded `proxy.ts`. Next.js 16's Turbopack requires `export const config` in middleware/proxy files to be a statically analysable object literal — referencing an imported variable (like `defaultMatcherConfig` from `@ampless/runtime/middleware`) fails the build:

```
Next.js can't recognize the exported `config` field in route.
It needs to be a static object.
```

Drop the re-export pattern and inline the matcher array in the scaffold. `defaultMatcherConfig` stays exported from `@ampless/runtime/middleware` as a documentation reference (with a JSDoc note explaining the Turbopack constraint), but isn't used by the scaffold anymore.

Existing scaffolds need to edit their `proxy.ts` (or `middleware.ts`) to inline `config = { matcher: [...] }` directly.
