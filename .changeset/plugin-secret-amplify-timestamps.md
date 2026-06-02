---
"@ampless/backend": patch
---

Fix `hasPluginSecret()` returning `false` on reload despite the
sk row clearly existing in DynamoDB — the actual root cause of
the symptom that survived through PR #200 → #204 → #206 → #208.

The `plugin-secret-handler` Lambda was writing rows with raw
`PutItemCommand` and only the explicit fields (`sk`, `value`,
`lastSetAt`). Amplify Gen 2 auto-generates non-nullable
`createdAt` / `updatedAt` (`AWSDateTime!`) on every model, so
the AppSync `get` resolver refused to project a row that
lacked them and returned the entire row as `null`:

```json
{
  "data": { "getPluginSecretIndicator": null },
  "errors": [
    {
      "path": ["getPluginSecretIndicator", "createdAt"],
      "message": "Cannot return null for non-nullable type: 'AWSDateTime' within parent 'PluginSecretIndicator'"
    },
    {
      "path": ["getPluginSecretIndicator", "updatedAt"],
      "message": "Cannot return null for non-nullable type: 'AWSDateTime' within parent 'PluginSecretIndicator'"
    }
  ]
}
```

`hasPluginSecret()` catches every error and folds to `false`,
so the admin UI silently treated saved secrets as unset.

Switched both writes to `UpdateItemCommand`:

```
SET <field> = :value,
    #createdAt = if_not_exists(#createdAt, :now),
    #updatedAt = :now
```

`if_not_exists(#createdAt, :now)` preserves the original
`createdAt` across Replace operations so the audit trail of
when the secret was first stored survives rotations.

Tests:
- Regression guard asserting both rows carry `createdAt` /
  `updatedAt` after `setPluginSecret`.
- Replace-preserves-createdAt guard exercising the
  `if_not_exists` clause.
- Mock DDB driver rewritten to handle `UpdateItemCommand` with
  paren-aware `UpdateExpression` parsing (the naive
  `body.split(',')` chops `if_not_exists(x, :y)` in half — a
  bug worth calling out because it would have silently
  dropped the regression guards).

No schema change. Amplify does not need to recreate the
tables; existing rows that were created by the broken Put
path are still missing the timestamps and will continue to
fail `hasPluginSecret()` until they are re-written (Replace
via the admin UI does this).
