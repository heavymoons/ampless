---
"@ampless/backend": patch
---

Fix `next build` type error on scaffolded `amplify/events/processor-{trusted,untrusted}/handler.ts`:

```
Type '(string | AmplessPlugin)[] | undefined' is not assignable to type 'AmplessPlugin[] | undefined'.
```

`Config['plugins']` (the type of `cms.config.plugins`) is `Array<AmplessPlugin | string>` to leave room for string-name entries used by future dynamic loading. The processor factories' `opts.plugins` was typed `AmplessPlugin[]`, so the thin-shell `plugins: config.plugins` pass-through failed Next.js 16's stricter type check at production build.

Both processor factories already filter out non-object entries at runtime; widen the `opts.plugins` type to `Config['plugins']` so the scaffolded shell type-checks cleanly without a cast.

Surfaced via Amplify Hosting build for the dogfood site `ampless.heavymoons.net`.
