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
 * On the read side there are two FUNDAMENTALLY DIFFERENT paths, and they
 * must be handled differently — the value's runtime shape is NOT enough
 * to disambiguate them:
 *
 *   1. GraphQL wire read (auto-generated CRUD resolver, custom resolvers,
 *      raw GraphQL fetch) — the value arrives as a JSON-encoded string,
 *      regardless of the underlying type. Use `decodeAwsJson` to parse it
 *      back into the native JS value.
 *
 *   2. Direct DynamoDBDocumentClient read (the trusted processor and the
 *      MCP Lambda read straight from DynamoDB) — DocumentClient already
 *      unmarshals AWSJSON-backed attributes into native JS types
 *      (S→string, N→number, BOOL→boolean, M→object). The value is ALREADY
 *      the correct JS type and must be used AS-IS. Do NOT run
 *      `decodeAwsJson` / `JSON.parse` on it.
 *
 * Why the distinction is load-bearing: a native scalar STRING from path 2
 * is indistinguishable, by type alone, from a wire string on path 1. But
 * `decodeAwsJson("1470")` === `JSON.parse("1470")` === the number `1470`,
 * so running the decoder on a DocumentClient scalar string silently
 * double-decodes numeric-looking settings/bodies (this caused a
 * site-wide 500). The "non-strings pass through unchanged" tolerance of
 * `decodeAwsJson` does NOT make it safe on DocumentClient reads — scalar
 * strings are exactly the case it corrupts. Pick the decoder by read PATH,
 * never by the value's runtime shape.
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
 * Deserialise an AWSJSON value from a GraphQL wire read (path 1 above).
 * Non-string inputs pass through unchanged; strings go through
 * `JSON.parse` and throw if not valid JSON.
 *
 * Only call this on values read over the GraphQL wire. Do NOT call it on
 * values read directly via DynamoDBDocumentClient — those are already
 * native JS types, and a native scalar string (e.g. "1470") would be
 * double-decoded into a number. See the module doc block above.
 */
export function decodeAwsJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return JSON.parse(value)
}
