// Test support (never imported by package code): an in-memory stand-in for
// the Post DynamoDB table that executes the REAL
// `templates/_shared/amplify/data/update-post-if-unchanged.js` resolver's
// request() output, plus a "stock writer" that mutates the row the way the
// Amplify-generated `updatePost` resolver does (no content condition,
// `updatedAt` from the clock with millisecond precision).
//
// Plain JS with no imports so other packages' tests (admin, MCP) can load it
// by relative path without pulling it under their tsconfig rootDir.
//
// What it models, and what it cannot prove:
//   - ConditionExpression `=` with DynamoDB-like deep equality: maps
//     compare order-insensitively, lists order-sensitively, types strictly.
//   - attribute_exists / attribute_not_exists / attribute_type(.., 'NULL').
//   - SET / REMOVE.
//   - The resolver's constrained grammar only; anything else throws, so a
//     grammar change fails tests instead of being mis-evaluated.
// Values are kept native (`toMapValues` is the identity here), so whether
// real DynamoDB applies `=` to M / L attribute values exactly like this is
// NOT proven by these tests — verify on a real backend.

/** Fake `@aws-appsync/utils`, driven by a mutable `clock.nowMs`. */
export function appsyncUtilsMock(clock) {
  return {
    util: {
      time: {
        nowEpochMilliSeconds: () => clock.nowMs,
        nowISO8601: () => new Date(clock.nowMs).toISOString(),
        parseISO8601ToEpochMilliSeconds: (s) => {
          const ms = Date.parse(s)
          return Number.isNaN(ms) ? undefined : ms
        },
        epochMilliSecondsToFormatted: (ms, format, zone) => {
          if (zone !== 'UTC' || format !== "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'") {
            throw new Error(`unexpected format ${format} / zone ${zone}`)
          }
          return new Date(ms).toISOString()
        },
      },
      dynamodb: {
        toMapValues: (v) => v,
        toDynamoDB: (v) => v,
      },
      error: (message, type) => {
        throw Object.assign(new Error(message), { type })
      },
    },
    runtime: {
      earlyReturn: (value) => ({ earlyReturn: true, value }),
    },
  }
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

/** DynamoDB-like equality: M order-insensitive, L order-sensitive, strict types. */
export function dynamoEquals(a, b) {
  if (a === null || b === null) return a === b
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => dynamoEquals(x, b[i]))
  }
  if (typeof a === 'object' || typeof b === 'object') {
    if (typeof a !== 'object' || typeof b !== 'object') return false
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && dynamoEquals(a[k], b[k]))
  }
  return a === b
}

function typeOf(v) {
  if (v === null) return 'NULL'
  if (Array.isArray(v)) return 'L'
  if (typeof v === 'object') return 'M'
  if (typeof v === 'string') return 'S'
  if (typeof v === 'number') return 'N'
  if (typeof v === 'boolean') return 'BOOL'
  throw new Error(`unsupported value ${String(v)}`)
}

function resolveName(names, token) {
  if (!Object.prototype.hasOwnProperty.call(names, token)) throw new Error(`unknown expression name ${token}`)
  return names[token]
}
function resolveValue(values, token) {
  if (!Object.prototype.hasOwnProperty.call(values, token)) throw new Error(`unknown expression value ${token}`)
  return values[token]
}

function evalAtom(atom, item, names, values) {
  let m = /^(#\w+) = (:\w+)$/.exec(atom)
  if (m) {
    const attr = resolveName(names, m[1])
    return item !== null && Object.prototype.hasOwnProperty.call(item, attr) && dynamoEquals(item[attr], resolveValue(values, m[2]))
  }
  m = /^attribute_exists\((#\w+)\)$/.exec(atom)
  if (m) return item !== null && Object.prototype.hasOwnProperty.call(item, resolveName(names, m[1]))
  m = /^attribute_not_exists\((#\w+)\)$/.exec(atom)
  if (m) return item === null || !Object.prototype.hasOwnProperty.call(item, resolveName(names, m[1]))
  m = /^attribute_type\((#\w+), (:\w+)\)$/.exec(atom)
  if (m) {
    const attr = resolveName(names, m[1])
    return item !== null && Object.prototype.hasOwnProperty.call(item, attr) && typeOf(item[attr]) === resolveValue(values, m[2])
  }
  throw new Error(`condition atom outside the supported grammar: ${atom}`)
}

/** Evaluate the resolver's condition grammar against `item` (null = no item). */
export function evaluateCondition(expression, item, names, values) {
  return expression.split(' AND ').every((clause) => {
    if (clause.startsWith('(')) {
      if (!clause.endsWith(')')) throw new Error(`unbalanced clause: ${clause}`)
      return clause
        .slice(1, -1)
        .split(' OR ')
        .some((atom) => evalAtom(atom, item, names, values))
    }
    return evalAtom(clause, item, names, values)
  })
}

function applyUpdate(item, update) {
  const m = /^SET (.+?)(?: REMOVE (.+))?$/.exec(update.expression)
  if (!m) throw new Error(`update outside the supported grammar: ${update.expression}`)
  const next = { ...item }
  for (const assignment of m[1].split(', ')) {
    const a = /^(#\w+) = (:\w+)$/.exec(assignment)
    if (!a) throw new Error(`SET clause outside the supported grammar: ${assignment}`)
    next[resolveName(update.expressionNames, a[1])] = clone(resolveValue(update.expressionValues, a[2]))
  }
  if (m[2]) {
    for (const name of m[2].split(', ')) delete next[resolveName(update.expressionNames, name)]
  }
  return next
}

const ROW_FIELDS = ['postId', 'slug', 'title', 'excerpt', 'format', 'body', 'status', 'publishedAt', 'tags', 'metadata', 'updatedAt']

/**
 * The row as a GraphQL read (getPost / the mutation's selection set)
 * returns it: missing attributes come back as null and the AWSJSON fields
 * (body, metadata) as JSON strings — what the admin / MCP `toCorePost`
 * mappers expect.
 */
export function wireRow(item) {
  if (!item) return null
  const row = {}
  for (const f of ROW_FIELDS) {
    const v = Object.prototype.hasOwnProperty.call(item, f) ? item[f] : null
    row[f] = (f === 'body' || f === 'metadata') && v !== null ? JSON.stringify(v) : clone(v)
  }
  return row
}

function conditionalCheckFailed() {
  return { message: 'The conditional request failed', type: 'DynamoDB:ConditionalCheckFailedException' }
}

/**
 * In-memory Post table holding one row (`item`, or null once deleted).
 * `clock.nowMs` drives both the resolver (through `appsyncUtilsMock`) and
 * the stock writer, so tests can freeze time to reproduce same-millisecond
 * writes.
 */
export function createFakePostTable(initialItem, clock) {
  const table = {
    item: clone(initialItem),
    writes: 0,

    /** Run the real resolver module end to end: request → DynamoDB → response. */
    runResolver(resolver, args) {
      const ctx = { args, stash: {}, identity: {} }
      const req = resolver.request(ctx)
      if (req.operation !== 'UpdateItem') throw new Error(`unexpected operation ${req.operation}`)
      const key = req.key.postId
      const item = table.item && table.item.postId === key ? table.item : null
      const cond = req.condition
      const names = { ...req.update.expressionNames, ...cond.expressionNames }
      // Mirror DynamoDB: an expression value the expressions never use is a
      // ValidationException.
      const allValues = { ...req.update.expressionValues, ...cond.expressionValues }
      for (const token of Object.keys(allValues)) {
        if (!req.update.expression.includes(token) && !cond.expression.includes(token)) {
          throw new Error(`unused expression value ${token}`)
        }
      }
      if (!evaluateCondition(cond.expression, item, names, cond.expressionValues)) {
        ctx.error = conditionalCheckFailed()
        return resolver.response(ctx)
      }
      table.item = applyUpdate(item, req.update)
      table.writes += 1
      ctx.result = clone(table.item)
      return resolver.response(ctx)
    },

    /**
     * Unconditional write as the stock Amplify `updatePost` resolver does it
     * (external GraphQL writer, old client, MCP update_post without
     * expectedVersion): sets the given fields and `updatedAt` = clock.
     * A null value is stored as NULL. Throws when the row is gone (the stock
     * resolver conditions only on the key existing).
     */
    stockUpdate(fields) {
      if (!table.item) throw Object.assign(new Error('The conditional request failed'), conditionalCheckFailed())
      table.item = { ...table.item, ...clone(fields), updatedAt: new Date(clock.nowMs).toISOString() }
      table.writes += 1
      return clone(table.item)
    },

    stockDelete() {
      table.item = null
    },
  }
  return table
}
