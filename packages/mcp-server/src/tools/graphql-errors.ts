import type { GraphqlErrorEntry } from './types.js'

/**
 * The GraphQL `errors` array a `GraphqlClient` attached to the Error it
 * threw (see `GraphqlClient.query`), or `null` when there is none (network
 * failures, clients that predate the contract).
 */
export function graphqlErrorsOf(err: unknown): GraphqlErrorEntry[] | null {
  if (!err || typeof err !== 'object') return null
  const errors = (err as { errors?: unknown }).errors
  return Array.isArray(errors) ? (errors as GraphqlErrorEntry[]) : null
}

/**
 * True when a GraphQL call failed because its mutation `condition` did not
 * hold — AppSync reports that as `errorType:
 * 'DynamoDB:ConditionalCheckFailedException'`. Checks the attached
 * `errors[].errorType` first and falls back to the exception name in the
 * message (errors without `errorType`, or clients that only keep the
 * message).
 */
export function isConditionalCheckFailed(err: unknown): boolean {
  const NAME = 'ConditionalCheckFailedException'
  const errors = graphqlErrorsOf(err)
  if (errors?.some((e) => typeof e?.errorType === 'string' && e.errorType.includes(NAME))) return true
  if (errors?.some((e) => typeof e?.message === 'string' && e.message.includes(NAME))) return true
  return err instanceof Error && err.message.includes(NAME)
}

const CONDITIONAL_MUTATION_FIELD = 'amplessUpdatePostIfUnchanged'
const UNDEFINED_FIELD = /\b(?:FieldUndefined|is undefined|not defined|unknown field|cannot query field)\b/i

/**
 * True when a call failed because the deployed schema has no
 * `amplessUpdatePostIfUnchanged` (a backend that was not upgraded): AppSync
 * rejects the document at validation, before any resolver runs, with e.g.
 * "Validation error of type FieldUndefined: Field
 * 'amplessUpdatePostIfUnchanged' in type 'Mutation' is undefined". Only
 * errors that name the mutation count, so an unrelated validation error is
 * never mistaken for it.
 */
export function isConditionalMutationMissing(err: unknown): boolean {
  const texts = (graphqlErrorsOf(err) ?? []).map((e) => `${e?.errorType ?? ''} ${e?.message ?? ''}`)
  if (err instanceof Error) texts.push(err.message)
  return texts.some((t) => t.includes(CONDITIONAL_MUTATION_FIELD) && UNDEFINED_FIELD.test(t))
}
