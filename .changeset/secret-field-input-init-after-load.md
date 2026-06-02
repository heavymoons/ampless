---
"@ampless/admin": patch
---

Fix `<SecretFieldInput>` showing the empty "unset" UI on
reload even when `hasPluginSecret()` returns `true`.

`<SecretFieldInput>` initialises its `useReducer` state from
the `hasValue` prop with the lazy-init form:

```ts
useReducer(reducer, hasValue, initialSecretFieldState)
```

This runs the initialiser **once** on mount — React does not
re-run it when `hasValue` later changes. The parent
`<PluginSettingsForm>` was rendering with
`secretHasValue = {}` immediately, then updating it after
the async `hasPluginSecret()` check resolved. Result:

1. Mount → `hasValue=false` → reducer state `{status: 'unset'}`
2. Effect resolves → `secretHasValue = { signingSecret: true }`
3. Re-render → child receives `hasValue=true` but ignores it
4. UI still shows the empty Save input

Gate the `<SecretFieldInput>` render on the check completing:
`secretHasValue` starts as `null` (= "still loading") and
flips to a Record once `hasPluginSecret()` has run for every
secret field. Display a pulsing skeleton placeholder during
the in-flight window so the layout height stays stable.

This was the final piece of the Phase 6a dogfood blocker
chain (PR #206 → #208 → #210 → this), surfacing after PR #210
made the AppSync read itself return the row correctly.
