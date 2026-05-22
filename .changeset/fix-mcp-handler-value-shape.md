---
"@ampless/backend": patch
---

Fix MCP HTTP endpoint always returning `invalid_token` for tokens
issued through the admin UI.

`mcp-handler.ts` read DynamoDB rows where `value` is an `a.json()`
field and assumed the attribute was always a JSON-encoded string. In
practice the admin UI's `installAdminKvProvider` calls AppSync's
auto-generated `CreateKvStore` mutation, which parses the incoming
AWSJSON input and stores `value` as a **native DynamoDB Map**. When
`DynamoDBDocumentClient` unmarshals it on read, it comes back as a
plain JS object — `JSON.parse(row.value)` then sees `[object Object]`,
throws, and the validator returns `null` → every Bearer turns into
401 `invalid_token`.

The existing trusted-processor's site-settings cache already dodges
this with `typeof raw === 'string' ? safeParse(raw) : raw`. Apply the
same dual-shape handling to the token validator: pass-through when
the value is already an object, JSON.parse when it's a string,
diagnostic-log + reject only when the shape is neither.

Regression test added: a row with `value` shaped as a native object
(matching what production DDB actually contains) now validates the
same as a row with `value` shaped as a JSON string.
