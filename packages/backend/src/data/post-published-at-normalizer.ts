// Write-time normalization of `Post.publishedAt` (#389 / #406).
//
// AppSync accepts any extended ISO 8601 `AWSDateTime` (`+09:00` offsets,
// missing seconds, 1-9 fractional digits, `±hh:mm:ss` offsets) and
// DynamoDB stores it verbatim. The `byStatus` GSI sorts on that raw
// string, so a non-canonical value lists posts out of order and can make
// a scheduled post appear early or late. The admin UI and MCP normalize
// before writing, but a direct GraphQL `createPost` / `updatePost` (any
// admin/editor client, scripts, the Amplify data client) bypasses both.
//
// `defineAmplessBackend` therefore inserts a VTL pipeline function
// (NONE data source) into the generated `Mutation.createPost` /
// `Mutation.updatePost` pipelines, immediately before the data function.
// It rewrites `publishedAt` to the canonical UTC form
// `YYYY-MM-DDTHH:mm:ss.sssZ` — the same output as
// `canonicalizeAwsDateTime` in `ampless` — and derives
// `publishedAtSortKey = <canonical publishedAt>#<postId>`, the unique
// sort key of the `byStatusSorted` GSI.
//
// How it hands the result to the data function: Amplify's generated data
// templates start with
//   #set( $args = $util.defaultIfNull($ctx.stash.transformedArgs, $ctx.args) )
// so this function writes a copy of the arguments to
// `$ctx.stash.transformedArgs` instead of mutating `$ctx.args`. It starts
// from any `transformedArgs` an earlier function already set, so other
// transformers keep working. backend.published-at.test.ts fails if the
// generated templates stop reading `transformedArgs`.
//
// Rules:
//   - A client-supplied `publishedAtSortKey` is always dropped; the key is
//     only ever derived here. It is removed from `$ctx.stash.defaultValues`
//     as well: Amplify's preAuth function merges the raw input into that
//     map, and the data template merges it underneath `$args.input`, so a
//     forged key would otherwise survive whenever this function does not
//     overwrite it.
//   - `publishedAt` absent: nothing else changes.
//   - `publishedAt: null` on update: both attributes are removed (the
//     data template turns null values into `REMOVE`). On create the sort
//     key is simply not written — a null GSI key attribute would be
//     rejected by DynamoDB.
//   - Unparseable values, and instants outside UTC years 0000-9999 (the
//     range `canonicalizeAwsDateTime` accepts), fail with ValidationError.
//
// `uuuu` (proleptic year), not `yyyy` (year-of-era): `yyyy` prints year 0
// as `0001`.
//
// The template is evaluated against the real AppSync VTL engine by
// `scripts/evaluate-published-at-normalizer.mjs`, alone and chained with
// the generated init / preAuth / data templates; its output is pinned in
// `post-published-at-normalizer.fixture.json` and compared with
// `canonicalizeAwsDateTime` in post-published-at-normalizer.test.ts.
// Re-run the script after editing the template or upgrading Amplify.

/** Epoch ms of 0000-01-01T00:00:00.000Z. */
export const PUBLISHED_AT_MIN_EPOCH_MS = -62167219200000
/** Epoch ms of 9999-12-31T23:59:59.999Z. */
export const PUBLISHED_AT_MAX_EPOCH_MS = 253402300799999

export type PublishedAtNormalizerOperation = 'create' | 'update'

function requestTemplate(op: PublishedAtNormalizerOperation): string {
  // On update a null publishedAt clears the sort key too; on create the
  // key is left out (see the header comment).
  const onNull = op === 'update' ? `      $util.qr($input.put("publishedAtSortKey", $null))\n` : ''
  return (
    `## [Start] ampless: normalize publishedAt (${op}). **\n` +
    `#set( $args = $util.defaultIfNull($ctx.stash.transformedArgs, $ctx.args) )\n` +
    `#set( $input = {} )\n` +
    `$util.qr($input.putAll($util.defaultIfNull($args.input, {})))\n` +
    `$util.qr($input.remove("publishedAtSortKey"))\n` +
    `#if( !$util.isNull($ctx.stash.defaultValues) )\n` +
    `  $util.qr($ctx.stash.defaultValues.remove("publishedAtSortKey"))\n` +
    `#end\n` +
    `#if( $input.containsKey("publishedAt") )\n` +
    `  #set( $raw = $input.get("publishedAt") )\n` +
    `  #if( $util.isNull($raw) )\n` +
    onNull +
    `  #else\n` +
    `    #set( $ms = $util.time.parseISO8601ToEpochMilliSeconds($raw) )\n` +
    `    #if( $util.isNull($ms) || $ms < ${PUBLISHED_AT_MIN_EPOCH_MS} || $ms > ${PUBLISHED_AT_MAX_EPOCH_MS} )\n` +
    `      $util.error("publishedAt is not a valid AWSDateTime: $raw", "ValidationError")\n` +
    `    #end\n` +
    `    #set( $canonical = $util.time.epochMilliSecondsToFormatted($ms, "uuuu-MM-dd'T'HH:mm:ss.SSS'Z'", "UTC") )\n` +
    `    $util.qr($input.put("publishedAt", $canonical))\n` +
    `    $util.qr($input.put("publishedAtSortKey", "\${canonical}#\${input.postId}"))\n` +
    `  #end\n` +
    `#end\n` +
    `#set( $newArgs = {} )\n` +
    `$util.qr($newArgs.putAll($args))\n` +
    `$util.qr($newArgs.put("input", $input))\n` +
    `$util.qr($ctx.stash.put("transformedArgs", $newArgs))\n` +
    `$util.toJson({"version": "2018-05-29", "payload": {}})\n` +
    `## [End] ampless: normalize publishedAt (${op}). **`
  )
}

/** Request mapping templates of the inserted pipeline functions. */
export const PUBLISHED_AT_NORMALIZER_REQUEST_TEMPLATES: Readonly<
  Record<PublishedAtNormalizerOperation, string>
> = {
  create: requestTemplate('create'),
  update: requestTemplate('update'),
}

/** Response mapping template (same default Amplify uses for its slot functions). */
export const PUBLISHED_AT_NORMALIZER_RESPONSE_TEMPLATE = '$util.toJson({})'
