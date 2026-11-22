#!/usr/bin/env node
// Evaluates the publishedAt normalizer VTL (src/data/post-published-at-normalizer.ts)
// with the real AppSync VTL engine and pins the results in
// src/data/post-published-at-normalizer.fixture.json:
//
//   - `results`: the normalizer alone, over a matrix of publishedAt
//     inputs. post-published-at-normalizer.test.ts compares them with
//     `canonicalizeAwsDateTime`.
//   - `pipeline`: the normalizer chained between the Amplify-generated
//     init / preAuth functions and the generated data function of
//     createPost / updatePost, so the pinned output is the PutItem /
//     UpdateItem request DynamoDB would receive. The hashes of the
//     generated templates are pinned too; backend.published-at.test.ts
//     fails when a synth produces different ones (Amplify upgrade), which
//     means: re-run this script and re-check the pipeline results.
//
// Re-run after editing the template or upgrading Amplify:
//
//   node --experimental-strip-types \
//     packages/backend/scripts/evaluate-published-at-normalizer.mjs \
//     --resolvers <transformer-assets dir>/resolvers
//
// The resolvers dir is what a synth writes generated templates to
// ($TMPDIR/transformer-assets-*/resolvers); backend.published-at.test.ts
// prints the one its synth used when the hashes differ.
//
// It only calls `aws appsync evaluate-mapping-template`, which is
// stateless: it needs AWS credentials but no AppSync API and touches no
// data. Region defaults to us-east-1 (override with AWS_REGION).

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { PUBLISHED_AT_NORMALIZER_REQUEST_TEMPLATES } = await import(
  join(here, '../src/data/post-published-at-normalizer.ts')
)
const FIXTURE = join(here, '../src/data/post-published-at-normalizer.fixture.json')
const REGION = process.env.AWS_REGION ?? 'us-east-1'

const resolversArg = process.argv.indexOf('--resolvers')
const RESOLVERS = resolversArg === -1 ? undefined : process.argv[resolversArg + 1]
if (!RESOLVERS) {
  process.stderr.write('usage: evaluate-published-at-normalizer.mjs --resolvers <dir>\n')
  process.exit(1)
}

const POST_ID = 'post-1'

// [name, publishedAt] — each is evaluated as `{ postId, publishedAt }`.
const PUBLISHED_AT_CASES = [
  ['utc millis', '2026-05-01T12:34:56.789Z'],
  ['utc no fraction', '2026-05-01T12:34:56Z'],
  ['+09:00', '2026-05-01T09:00:00+09:00'],
  ['-05:00', '2026-05-01T09:00:00-05:00'],
  ['+00:00', '2026-05-01T09:00:00+00:00'],
  ['no seconds Z', '2026-05-01T09:00Z'],
  ['no seconds +09:00', '2026-05-01T09:00+09:00'],
  ['fraction 1 digit', '2026-05-01T12:34:56.1Z'],
  ['fraction 2 digits', '2026-05-01T12:34:56.12Z'],
  ['fraction 3 digits', '2026-05-01T12:34:56.123Z'],
  ['fraction 4 digits', '2026-05-01T12:34:56.1234Z'],
  ['fraction 5 digits', '2026-05-01T12:34:56.12345Z'],
  ['fraction 6 digits', '2026-05-01T12:34:56.123456Z'],
  ['fraction 7 digits', '2026-05-01T12:34:56.1234567Z'],
  ['fraction 8 digits', '2026-05-01T12:34:56.12345678Z'],
  ['fraction 9 digits', '2026-05-01T12:34:56.123456789Z'],
  ['fraction 9 digits +09:00', '2026-05-01T09:00:00.999999999+09:00'],
  ['+hh:mm:ss', '2026-05-01T12:00:00+05:30:15'],
  ['-hh:mm:ss', '2026-05-01T12:00:00-05:30:15'],
  ['+18:00', '2026-05-01T12:00:00+18:00'],
  ['-18:00', '2026-05-01T12:00:00-18:00'],
  ['+19:00', '2026-05-01T12:00:00+19:00'],
  ['second 60', '2026-05-01T12:34:60Z'],
  ['hour 24', '2026-05-01T24:00:00Z'],
  ['Feb 30', '2026-02-30T00:00:00Z'],
  ['Feb 29 leap year', '2028-02-29T00:00:00Z'],
  ['Feb 29 non-leap year', '2027-02-29T00:00:00Z'],
  ['day rollover across offset', '2026-12-31T23:30:00-01:00'],
  ['year 0000', '0000-01-01T00:00:00Z'],
  ['before year 0000', '0000-01-01T00:00:00+00:01'],
  ['9999-12-31 max', '9999-12-31T23:59:59.999Z'],
  ['9999-12-31 overflow via offset', '9999-12-31T23:59:59.999-01:00'],
  ['lowercase z', '2026-05-01T12:34:56z'],
  ['lowercase t', '2026-05-01t12:34:56Z'],
  ['no zone', '2026-05-01T12:34:56'],
  ['date only', '2026-05-01'],
  ['garbage', 'not-a-date'],
  ['empty string', ''],
]

/** @type {{ name: string, args: Record<string, unknown>, stash?: Record<string, unknown> }[]} */
const CASES = [
  ...PUBLISHED_AT_CASES.map(([name, publishedAt]) => ({
    name,
    args: { input: { postId: POST_ID, publishedAt } },
  })),
  { name: 'publishedAt null', args: { input: { postId: POST_ID, publishedAt: null } } },
  { name: 'publishedAt absent', args: { input: { postId: POST_ID, title: 'T' } } },
  {
    name: 'client publishedAtSortKey, publishedAt absent',
    args: { input: { postId: POST_ID, publishedAtSortKey: 'forged#key' } },
  },
  {
    name: 'client publishedAtSortKey, publishedAt set',
    args: {
      input: {
        postId: POST_ID,
        publishedAt: '2026-05-01T09:00:00+09:00',
        publishedAtSortKey: 'forged#key',
      },
    },
  },
  {
    name: 'client publishedAtSortKey, publishedAt null',
    args: { input: { postId: POST_ID, publishedAt: null, publishedAtSortKey: 'forged#key' } },
  },
  {
    name: 'existing transformedArgs in stash',
    args: { input: { postId: POST_ID, publishedAt: '2026-01-01T00:00:00Z', title: 'from args' } },
    stash: {
      transformedArgs: {
        input: { postId: POST_ID, publishedAt: '2026-05-01T09:00:00+09:00', title: 'from stash' },
      },
      other: 'kept',
    },
  },
  {
    name: 'condition argument preserved',
    args: {
      input: { postId: POST_ID, publishedAt: '2026-05-01T09:00:00+09:00' },
      condition: { status: { eq: 'draft' } },
    },
  },
]

function evaluate(template, context) {
  const out = execFileSync(
    'aws',
    [
      'appsync',
      'evaluate-mapping-template',
      '--region',
      REGION,
      '--output',
      'json',
      '--template',
      template,
      '--context',
      JSON.stringify(context),
    ],
    { encoding: 'utf8' }
  )
  const res = JSON.parse(out)
  if (res.error) return { error: res.error.message }
  const stash = JSON.parse(res.stash)
  return { evaluationResult: JSON.parse(res.evaluationResult), stash }
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

const fixture = {
  templateSha256: {},
  generatedTemplateSha256: {},
  region: REGION,
  postId: POST_ID,
  results: [],
  pipeline: [],
}
for (const op of ['create', 'update']) {
  const template = PUBLISHED_AT_NORMALIZER_REQUEST_TEMPLATES[op]
  fixture.templateSha256[op] = sha256(template)
  for (const c of CASES) {
    const context = { arguments: c.args, stash: c.stash ?? {} }
    const result = evaluate(template, context)
    fixture.results.push({ op, name: c.name, context, result })
    process.stdout.write(`${op} ${c.name}: ${result.error ? 'error' : 'ok'}\n`)
  }
}

// --- Pipeline chain against the generated templates ---

const generated = readdirSync(RESOLVERS)
  .filter((f) => /^Mutation\.(create|update)Post\..*vtl$/.test(f))
  .sort()
for (const f of generated) {
  fixture.generatedTemplateSha256[f] = sha256(readFileSync(join(RESOLVERS, f), 'utf8'))
}
const generatedTemplate = (f) => {
  if (!(f in fixture.generatedTemplateSha256)) throw new Error(`${f} not found in ${RESOLVERS}`)
  return readFileSync(join(RESOLVERS, f), 'utf8')
}

const FORGED = 'forged#key'
const PIPELINE_CASES = [
  {
    name: '+09:00 with forged sort key',
    args: {
      input: {
        postId: POST_ID,
        publishedAt: '2026-05-01T09:00:00+09:00',
        publishedAtSortKey: FORGED,
      },
    },
  },
  {
    name: 'publishedAt absent with forged sort key',
    args: { input: { postId: POST_ID, title: 'T', publishedAtSortKey: FORGED } },
  },
  {
    name: 'publishedAt null with forged sort key',
    args: { input: { postId: POST_ID, publishedAt: null, publishedAtSortKey: FORGED } },
  },
  {
    name: 'invalid publishedAt',
    args: { input: { postId: POST_ID, publishedAt: '2026-02-30T00:00:00Z' } },
  },
  {
    name: 'condition argument preserved',
    args: {
      input: { postId: POST_ID, publishedAt: '2026-05-01T09:00:00-05:00' },
      condition: { status: { eq: 'draft' } },
    },
  },
]

for (const op of ['create', 'update']) {
  // What the resolver-level request template stashes before the first
  // function (backend.published-at.test.ts checks it still does).
  const seed = { typeName: 'Mutation', fieldName: `${op}Post`, conditions: [], metadata: {} }
  const steps = [
    ['init', generatedTemplate(`Mutation.${op}Post.init.1.req.vtl`)],
    ['preAuth', generatedTemplate(`Mutation.${op}Post.preAuth.1.req.vtl`)],
    // auth / postAuth only read the arguments and set hasAuth; they
    // need a caller identity, so they are not part of the chain.
    ['normalizer', PUBLISHED_AT_NORMALIZER_REQUEST_TEMPLATES[op]],
    ['data', generatedTemplate(`Mutation.${op}Post.req.vtl`)],
  ]
  for (const c of PIPELINE_CASES) {
    let stash = seed
    const entry = { op, name: c.name, arguments: c.args }
    for (const [step, template] of steps) {
      const result = evaluate(template, { arguments: c.args, stash })
      if (result.error) {
        entry.error = { step, message: result.error }
        break
      }
      stash = result.stash
      if (step === 'normalizer') entry.stashAfterNormalizer = stash
      if (step === 'data') entry.dataRequest = result.evaluationResult
    }
    fixture.pipeline.push(entry)
    process.stdout.write(
      `pipeline ${op} ${c.name}: ${entry.error ? `error at ${entry.error.step}` : 'ok'}\n`
    )
  }
}

writeFileSync(FIXTURE, JSON.stringify(fixture, null, 2) + '\n')
process.stdout.write(`wrote ${FIXTURE}\n`)
