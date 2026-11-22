// Test-only: evaluate the Post-state guard (`buildPostStateCondition` in
// events/posttag-sync.ts) against an in-memory item, the way DynamoDB
// would. Only the three clause forms the builder emits are understood; any
// other expression throws, so a builder change cannot silently pass a fake.

interface ConditionInput {
  ConditionExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, unknown>
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false
    for (const v of a) if (!b.has(v)) return false
    return true
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => sameValue(v, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a)
    const bk = Object.keys(b)
    if (ak.length !== bk.length) return false
    return ak.every((k) =>
      sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
    )
  }
  return false
}

/** `item` is the current item (`null` = no item, evaluated as an empty one). */
export function evaluatePostStateCondition(
  item: Record<string, unknown> | null,
  input: ConditionInput
): boolean {
  const expr = input.ConditionExpression
  if (!expr) throw new Error('fake: missing ConditionExpression')
  const names = input.ExpressionAttributeNames ?? {}
  const values = input.ExpressionAttributeValues ?? {}
  const current = item ?? {}
  const attr = (n: string) => {
    const a = names[n]
    if (!a) throw new Error(`fake: unknown attribute name ${n}`)
    return a
  }
  const value = (v: string) => {
    if (!(v in values)) throw new Error(`fake: unknown attribute value ${v}`)
    return values[v]
  }
  return expr.split(' AND ').every((clause) => {
    let m = /^(#\w+) = (:\w+)$/.exec(clause)
    if (m) {
      const a = attr(m[1]!)
      return current[a] !== undefined && current[a] !== null && sameValue(current[a], value(m[2]!))
    }
    m = /^attribute_not_exists\((#\w+)\)$/.exec(clause)
    if (m) return current[attr(m[1]!)] === undefined
    m = /^attribute_type\((#\w+), (:\w+)\)$/.exec(clause)
    if (m) {
      if (value(m[2]!) !== 'NULL') throw new Error(`fake: unsupported type ${String(value(m[2]!))}`)
      return current[attr(m[1]!)] === null
    }
    throw new Error(`fake: unsupported condition clause ${JSON.stringify(clause)}`)
  })
}

/** The error DynamoDB returns when the ConditionCheck of a 2-item transaction fails. */
export function guardCancelled(): Error {
  const err = new Error(
    'Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]'
  )
  err.name = 'TransactionCanceledException'
  Object.assign(err, {
    CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
  })
  return err
}
