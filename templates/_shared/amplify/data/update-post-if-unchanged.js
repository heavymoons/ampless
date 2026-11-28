import { util } from '@aws-appsync/utils'

// AppSync JS resolver: `amplessUpdatePostIfUnchanged(postId, patch, expected)`.
//
// One DynamoDB UpdateItem on the Post table whose ConditionExpression
// checks, in the same atomic write, that the stored row still holds
// EVERY value the caller read (`expected`) — not just `updatedAt`.
// `updatedAt` alone is not enough: the stock Amplify resolvers stamp it
// with millisecond precision, so two writes in the same millisecond leave
// it unchanged and an updatedAt-only condition would let a stale write
// through. Comparing the fields themselves closes that gap for every
// field the caller conditions on.
//
// `patch` / `expected` are JSON strings (`String!` arguments, parsed here),
// not AWSJSON: their nested values (body / metadata) become native values
// that `util.dynamodb.toMapValues` marshals to the same DynamoDB types the
// stock resolver stores for AWSJSON fields (object → M, string → S, number
// → N, array → L). See packages/ampless/src/awsjson.ts.
//
//   patch    — the fields to write. `null` REMOVEs a nullable field
//              (excerpt / body / publishedAt / tags / metadata); `''` is
//              a value (excerpt '' is SET). Absent keys are untouched.
//   expected — the post exactly as the caller read it through the admin /
//              MCP `toCorePost` mappers: `updatedAt` (required) plus each
//              field the caller wants conditioned on; it must contain
//              every patched field, `format` when `body` is patched and
//              `body` when `format` is patched. `null` means "absent".
//
// The mappers collapse some stored values (null excerpt → undefined, null
// format → 'markdown', null status → 'draft', null tags → [], non-object
// metadata → undefined). The condition mirrors exactly those collapses, so
// a value read through a mapper always matches the row it was read from.
// Anything the mappers lose beyond that (null elements dropped from tags,
// a non-object metadata, a body string that decodes to another type,
// integers beyond 2^53) makes the condition fail: a false conflict, never
// a silent overwrite.
//
// On success `updatedAt` is set to max(now, expected + 1 ms), so it is
// strictly newer than the version the caller read even when the clock
// has not moved (PostHistory snapshot ids are `${postId}#${updatedAt}`).
// `createdAt` and every other attribute are left as they are.
//
// APPSYNC_JS restrictions respected here: no try/catch, no classic `for`
// / `while` loops, no recursion, no `new` — only for-of and array methods.
//
// Expressions use a deliberately small grammar so tests can evaluate them
// (packages/backend/src/data/post-table-fake.js): condition clauses joined
// by ' AND ', each `#n = :v`, `attribute_exists(#n)`,
// `attribute_not_exists(#n)`, `attribute_type(#n, :v)` or a parenthesized
// ' OR ' group of those; update `SET #n = :v, ...` plus an optional
// ` REMOVE #n, ...`.

const FIELDS = ['title', 'slug', 'excerpt', 'format', 'body', 'status', 'publishedAt', 'tags', 'metadata']
const NULLABLE = ['excerpt', 'body', 'publishedAt', 'tags', 'metadata']
const FORMATS = ['tiptap', 'markdown', 'html', 'static']
const STATUSES = ['draft', 'published']
const UPDATED_AT_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"

// `key in obj` / hasOwnProperty are avoided for runtime portability. Values
// come from JSON.parse, which never yields `undefined`, and keys are only
// ever looked up from FIELDS, so this is an own-key presence test.
function has(obj, key) {
  return obj[key] !== undefined
}

function invalid(message) {
  util.error(message, 'AmplessValidationError')
}

function parseObjectArg(name, raw) {
  const value = JSON.parse(raw)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${name} must be a JSON object`)
  }
  return value
}

function validatePatchValue(field, value) {
  if (value === null) {
    if (!NULLABLE.includes(field)) invalid(`patch.${field} cannot be null`)
    return
  }
  if (field === 'title' || field === 'slug') {
    if (typeof value !== 'string' || value === '') invalid(`patch.${field} must be a non-empty string`)
  } else if (field === 'excerpt') {
    if (typeof value !== 'string') invalid('patch.excerpt must be a string or null')
  } else if (field === 'format') {
    if (!FORMATS.includes(value)) invalid(`patch.format must be one of ${FORMATS.join(', ')}`)
  } else if (field === 'status') {
    if (!STATUSES.includes(value)) invalid(`patch.status must be one of ${STATUSES.join(', ')}`)
  } else if (field === 'publishedAt') {
    const ms = typeof value === 'string' ? util.time.parseISO8601ToEpochMilliSeconds(value) : undefined
    if (typeof ms !== 'number') invalid('patch.publishedAt must be an ISO 8601 date-time string or null')
  } else if (field === 'tags') {
    if (!Array.isArray(value) || !value.every((t) => typeof t === 'string')) {
      invalid('patch.tags must be an array of strings or null')
    }
  } else if (field === 'metadata') {
    if (typeof value !== 'object' || Array.isArray(value)) invalid('patch.metadata must be an object or null')
  }
}

// Stored values the read mappers collapse onto `value` (besides `value`
// itself): a missing / NULL attribute. Only these defaults collapse.
function collapsesMissing(field, value) {
  if (field === 'format') return value === 'markdown'
  if (field === 'status') return value === 'draft'
  if (field === 'tags') return Array.isArray(value) && value.length === 0
  return false
}

export function request(ctx) {
  const postId = ctx.args.postId
  const patch = parseObjectArg('patch', ctx.args.patch)
  const expected = parseObjectArg('expected', ctx.args.expected)

  const patchKeys = Object.keys(patch)
  if (patchKeys.length === 0) invalid('patch must set at least one field')
  for (const key of patchKeys) {
    if (!FIELDS.includes(key)) invalid(`patch has an unknown field "${key}"`)
    validatePatchValue(key, patch[key])
  }
  for (const key of Object.keys(expected)) {
    if (key !== 'updatedAt' && !FIELDS.includes(key)) invalid(`expected has an unknown field "${key}"`)
  }
  if (typeof expected.updatedAt !== 'string' || expected.updatedAt === '') {
    invalid('expected.updatedAt is required')
  }
  const prevMs = util.time.parseISO8601ToEpochMilliSeconds(expected.updatedAt)
  if (typeof prevMs !== 'number') invalid('expected.updatedAt must be an ISO 8601 date-time string')
  for (const key of patchKeys) {
    if (!has(expected, key)) invalid(`expected.${key} is required because patch sets it`)
  }
  if (has(patch, 'body') && !has(expected, 'format')) invalid('expected.format is required because patch sets body')
  if (has(patch, 'format') && !has(expected, 'body')) invalid('expected.body is required because patch sets format')

  // ── Condition ────────────────────────────────────────────────────────
  const condNames = { '#postId': 'postId', '#updatedAt': 'updatedAt' }
  const condValues = { ':e_updatedAt': expected.updatedAt }
  const clauses = ['attribute_exists(#postId)', '#updatedAt = :e_updatedAt']
  let usesNull = false
  for (const field of FIELDS) {
    if (has(expected, field)) {
      const value = expected[field]
      const name = `#${field}`
      condNames[name] = field
      const missing = [`attribute_not_exists(${name})`, `attribute_type(${name}, :NULL)`]
      if (value === null || value === undefined) {
        usesNull = true
        clauses.push(`(${missing.join(' OR ')})`)
      } else {
        const ref = `:e_${field}`
        condValues[ref] = value
        if (collapsesMissing(field, value)) {
          usesNull = true
          clauses.push(`(${[`${name} = ${ref}`, ...missing].join(' OR ')})`)
        } else {
          clauses.push(`${name} = ${ref}`)
        }
      }
    }
  }
  // DynamoDB rejects unused expression values, so :NULL only when used.
  if (usesNull) condValues[':NULL'] = 'NULL'

  // ── Update ───────────────────────────────────────────────────────────
  const nowMs = util.time.nowEpochMilliSeconds()
  const nextMs = nowMs > prevMs ? nowMs : prevMs + 1
  const updateNames = { '#updatedAt': 'updatedAt' }
  const updateValues = {
    ':p_updatedAt': util.time.epochMilliSecondsToFormatted(nextMs, UPDATED_AT_FORMAT, 'UTC'),
  }
  const sets = []
  const removes = []
  for (const field of FIELDS) {
    if (has(patch, field)) {
      updateNames[`#${field}`] = field
      if (patch[field] === null) {
        removes.push(`#${field}`)
      } else {
        sets.push(`#${field} = :p_${field}`)
        updateValues[`:p_${field}`] = patch[field]
      }
    }
  }
  sets.push('#updatedAt = :p_updatedAt')
  let updateExpression = `SET ${sets.join(', ')}`
  if (removes.length > 0) updateExpression = `${updateExpression} REMOVE ${removes.join(', ')}`

  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues({ postId }),
    update: {
      expression: updateExpression,
      expressionNames: updateNames,
      expressionValues: util.dynamodb.toMapValues(updateValues),
    },
    condition: {
      expression: clauses.join(' AND '),
      expressionNames: condNames,
      expressionValues: util.dynamodb.toMapValues(condValues),
    },
  }
}

// A failed condition surfaces as errorType
// 'DynamoDB:ConditionalCheckFailedException' (what the clients map to a
// conflict); validation failures as 'AmplessValidationError'.
export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)
  return ctx.result
}
