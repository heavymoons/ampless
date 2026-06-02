---
"@ampless/backend": patch
"@ampless/admin": patch
---

Remove `siteId` column from the Phase 6a `PluginSecret` +
`PluginSecretIndicator` DynamoDB tables.

When the two tables were added in Phase 6a (alpha.45+), they
copied the `siteId + sk` composite identifier convention from
pre-`remove-siteid-from-schema` code, even though every other
DynamoDB-backed model in the project (`KvStore`, `Post`, `Page`,
`Media`, `Taxonomy`, `PostTag`) had already migrated to a
single-id identifier as part of that earlier major bump. The
two Phase 6a tables were the lone holdouts — a regression that
shipped because the new models were added against an outdated
mental model of the schema.

Concretely:

- `PluginSecret`: identifier changes from `['siteId', 'sk']` to
  `['sk']`. The `siteId` field is removed from the model.
- `PluginSecretIndicator`: same change.
- `plugin-secret-handler` Lambda: `marshall({ sk, value })` /
  `marshall({ sk, lastSetAt })` for puts, `marshall({ sk })`
  for deletes.
- `processor-trusted` Lambda's `ctx.secret()` GetItem: key is
  now `marshall({ sk })`.
- `@ampless/admin` `hasPluginSecret()`: AppSync `model.get({ sk })`
  instead of `model.get({ siteId, sk })`.

Amplify recreates both DynamoDB tables on the next deploy — any
existing `siteId='default'` rows are dropped along with the
table. For dogfood sites that had partial Phase 6a data this
means re-entering plugin secrets through the admin UI after
deploy.

This patch does not by itself diagnose the separate symptom
seen during dogfood on `ishinao.net` where `hasPluginSecret()`
returned `false` after page reload despite the row existing in
DynamoDB — diagnosis of that issue continues in a separate
investigation. The cleanup here is justified independently as a
schema-consistency regression fix.
