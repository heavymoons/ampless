#!/usr/bin/env node
/**
 * `ampless-migrate-published-at` — CLI wrapper around
 * `runPublishedAtMigration` (see ./published-at.ts). Dry-run unless
 * `--apply` is given. Credentials come from the default AWS provider chain
 * (AWS_PROFILE, env vars, SSO, ...).
 */
import { parseArgs } from 'node:util'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { runPublishedAtMigration, type PublishedAtMigrationSummary } from './published-at.js'

const USAGE = `Usage: ampless-migrate-published-at --table <PostTableName> [options]

Rewrites every Post's publishedAt to canonical UTC (YYYY-MM-DDTHH:mm:ss.sssZ)
and sets publishedAtSortKey (<canonical>#<postId>). Dry-run by default.

Options:
  --table <name>                 Physical Post table name (Post-<apiId>-NONE). Required.
  --region <region>              AWS region (default: from the AWS config / env).
  --apply                        Write the changes (default: dry-run, no writes).
  --max-writes-per-second <n>    Write throttle (default: 10).
  --json                         Print the summary as JSON on stdout (logs go to stderr).
  -h, --help                     Show this help.

Credentials come from the default AWS provider chain (e.g. AWS_PROFILE).`

function printSummary(summary: PublishedAtMigrationSummary, out: (line: string) => void): void {
  out(`mode:              ${summary.apply ? 'apply' : 'dry-run'}`)
  out(`scanned:           ${summary.scanned}`)
  out(`ok:                ${summary.ok}`)
  out(`to rewrite:        ${summary.toRewrite}`)
  out(`to remove sortKey: ${summary.toRemoveSortKey}`)
  if (summary.apply) {
    out(`rewritten:         ${summary.rewritten}`)
    out(`sortKey removed:   ${summary.sortKeyRemoved}`)
  }
  out(`unparseable:       ${summary.unparseable.length}`)
  out(`conflicts:         ${summary.conflicts.length}`)
  out(`failed:            ${summary.failed.length}`)
}

async function main(argv: string[]): Promise<number> {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        table: { type: 'string' },
        region: { type: 'string' },
        apply: { type: 'boolean', default: false },
        'max-writes-per-second': { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
      allowPositionals: false,
    }))
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`)
    return 2
  }

  if (values.help) {
    console.log(USAGE)
    return 0
  }
  if (!values.table) {
    console.error(`--table is required\n\n${USAGE}`)
    return 2
  }
  let maxWritesPerSecond = 10
  if (values['max-writes-per-second'] !== undefined) {
    maxWritesPerSecond = Number(values['max-writes-per-second'])
    if (!Number.isFinite(maxWritesPerSecond) || maxWritesPerSecond <= 0) {
      console.error('--max-writes-per-second must be a positive number')
      return 2
    }
  }

  // With --json, stdout carries only the summary; everything else → stderr.
  const out = values.json
    ? (line: string) => process.stderr.write(`${line}\n`)
    : (line: string) => console.log(line)

  if (values.apply) {
    out(
      `WARNING: --apply will UPDATE rows in table ${values.table}${values.region ? ` (${values.region})` : ''}.\n` +
        '  Each write is conditional on the scanned value, but take a backup / enable PITR first.\n' +
        '  Run without --apply first and review the dry-run output.'
    )
  } else {
    out(`Dry-run against ${values.table}: no writes will be made (pass --apply to write).`)
  }

  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient(values.region ? { region: values.region } : {})
  )

  let summary: PublishedAtMigrationSummary
  try {
    summary = await runPublishedAtMigration({
      client,
      tableName: values.table,
      apply: values.apply,
      maxWritesPerSecond,
      log: out,
    })
  } catch (err) {
    console.error('[migrate-published-at] migration aborted:', err)
    return 1
  }

  if (values.json) console.log(JSON.stringify(summary, null, 2))
  else printSummary(summary, out)

  if (summary.failed.length > 0) {
    out(`${summary.failed.length} row(s) failed; see the errors above, then re-run.`)
    return 1
  }
  if (summary.apply && (summary.unparseable.length > 0 || summary.conflicts.length > 0)) {
    out(
      'Some rows were not migrated: re-save the unparseable posts with a valid date, ' +
        'then re-run (conflicting rows are rechecked on the next run).'
    )
    return 1
  }
  return 0
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    console.error('[migrate-published-at] unexpected error:', err)
    process.exitCode = 1
  }
)
