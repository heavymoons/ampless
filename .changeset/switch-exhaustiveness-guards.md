---
"ampless": patch
---

Add exhaustiveness guards to two switches that previously had no `default`.

`compareRows` (post-list sort) and `validateThemeValue` (theme field validation) switched over a union without a default branch. Because `noImplicitReturns` is not enabled, adding a new `PostListSort` or `ThemeFieldType` value would have compiled cleanly and then returned `undefined` at runtime — a `NaN`-based broken sort order, or a silently dropped theme override. Both switches now end in a `never`-typed default: a missing case is a compile error, and the runtime falls back safely (stable `0` ordering / `null` rejection).
