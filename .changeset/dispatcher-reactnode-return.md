---
"@ampless/runtime": patch
---

Fix `next build` type error on scaffolded thin-shell page files:

```
Type 'ThemePostDispatcher' is not assignable to type 'FunctionComponent<any>'.
Type 'Promise<unknown>' is not assignable to type 'Promise<AwaitedReactNode>'.
```

The L1 extraction typed the three theme dispatcher return values as `Promise<unknown>` to avoid pulling React into ampless core. But `next build` (Next.js 16's stricter type-check pass) rejects this at the App Router page-default-export site.

Narrow the dispatchers' return type to `Promise<React.ReactNode>` via the `react` peer dep. Runtime semantics unchanged; the returned value already is a server component render result.

Surfaced via Amplify Hosting build for the dogfood site `ampless.heavymoons.net`.
