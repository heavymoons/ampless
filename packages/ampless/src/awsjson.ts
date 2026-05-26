/**
 * Encode / decode helpers for AppSync's AWSJSON scalar.
 *
 * Every `a.json()` field in the schema (Post.body, Post.metadata,
 * Page.body, KvStore.value, ...) carries a *JSON-encoded string* on
 * the GraphQL wire — regardless of whether the underlying value is a
 * string, object, or array. That rule holds for both write paths:
 *
 *   1. Amplify-generated client (`generateClient<Schema>().models.X.
 *      create({ body: ... })`) — Amplify does NOT auto-stringify, the
 *      caller must JSON.stringify before passing the value in.
 *   2. Raw GraphQL fetch (variables map, e.g. the MCP Lambda) — same
 *      rule, the variable must be a JSON-encoded string.
 *
 * Skipping the stringify for raw string inputs (a common mistake when
 * `format: 'markdown'`) trips AppSync's variable validator with
 *
 *     Variable 'body' has an invalid value.
 *
 * On the read side two wire shapes coexist:
 *
 *   - JSON-encoded string — what the auto-generated CRUD resolver and
 *     custom resolvers usually return.
 *   - Native object / Map — DynamoDBDocumentClient unmarshals
 *     AWSJSON-stored maps straight into JS objects when read directly
 *     from DynamoDB (the path used by the trusted processor and the
 *     MCP Lambda).
 *
 * `decodeAwsJson` handles both: pass strings through `JSON.parse`,
 * everything else as-is.
 */

/**
 * Serialise a value for an AWSJSON variable. `undefined` / `null` both
 * collapse to the literal string `"null"` (valid JSON) so AppSync sees
 * a well-formed AWSJSON payload either way.
 */
export function encodeAwsJson(value: unknown): string {
  return JSON.stringify(value ?? null)
}

/**
 * Deserialise an AWSJSON value from a GraphQL / DynamoDB read.
 * Tolerates both the wire-string shape and the auto-unmarshalled
 * native value. Throws if the string is not valid JSON.
 */
export function decodeAwsJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return JSON.parse(value)
}
