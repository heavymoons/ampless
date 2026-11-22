/**
 * Argument handling and reporting for `ampless-migrate-published-at`
 * (bin entry: ./cli.ts). Separated from the entry so tests can drive it
 * with mocked clients and capture the exit code.
 */
import { parseArgs } from 'node:util'
import {
  checkPublishedAtPreflight,
  runPublishedAtMigration,
  type MigrationClient,
  type PreflightClient,
  type PublishedAtMigrationSummary,
  type PublishedAtPreflight,
} from './published-at.js'
import {
  runPostTagCheck,
  type PostTagCheckClient,
  type PostTagCheckSummary,
} from './post-tags-check.js'

export const USAGE = `Usage: ampless-migrate-published-at --table <PostTableName> [options]
       ampless-migrate-published-at --check-post-tags --table <PostTableName> --post-tag-table <PostTagTableName> [options]

Default mode: rewrites every Post's publishedAt to canonical UTC
(YYYY-MM-DDTHH:mm:ss.sssZ) and sets publishedAtSortKey (<canonical>#<postId>).
Dry-run by default. Reads are strongly consistent. Each write is conditional
only on publishedAt / publishedAtSortKey still holding the scanned values; an
edit to any other attribute does not conflict and is not overwritten (only
those two attributes are SET). Before --apply it checks (DescribeTable) that
the table and its byStatusSorted index are ACTIVE and not backfilling, and
refuses otherwise.

--check-post-tags mode: scans PostTag and Post (strongly consistent) and
reports stale PostTag rows (post deleted / draft / no tags / wrong key /
outdated content) and missing rows. With --apply, rebuilds each affected
post's rows from its current state, then checks again. Each delete and put is
a transaction that also checks the Post still holds the state the rebuild
read, so a post edited mid-repair never gets rows of an old state and never
loses rows of its current one.

A dry-run that reports nothing to change does NOT by itself prove the
migration is complete. Follow the RUNBOOK procedure: stop every writer,
apply, dry-run to zero, drain the Post stream, trusted queue and DLQ, then
run --check-post-tags until it reports zero mismatches.

Options:
  --table <name>                 Physical Post table name (Post-<apiId>-NONE). Required.
  --check-post-tags              Check (and with --apply, repair) the PostTag table.
  --post-tag-table <name>        Physical PostTag table name (PostTag-<apiId>-NONE).
                                 Required with --check-post-tags.
  --region <region>              AWS region (default: from the AWS config / env).
  --apply                        Write the changes (default: dry-run, no writes).
  --max-writes-per-second <n>    Upper bound on write calls per second with --apply
                                 (UpdateItem / DeleteItem / TransactWriteItems).
                                 Writes are issued one at a time and spaced evenly,
                                 including within one post's rebuild; no burst
                                 (default: 10).
  --json                         Print the summary as JSON on stdout (logs go to stderr).
  -h, --help                     Show this help.

Exit codes:
  0  success (default mode: nothing failed; check mode: zero mismatches)
  1  failure: preflight not met with --apply, rows failed / unparseable /
     conflicting with --apply, or (check mode) mismatches found in a
     dry-run or remaining after --apply
  2  usage error

Credentials come from the default AWS provider chain (e.g. AWS_PROFILE).`

export interface CliClients {
  /** DynamoDBDocumentClient: Scan / Get / Put / Delete / Update. */
  doc: MigrationClient & PostTagCheckClient
  /** Plain DynamoDBClient: DescribeTable. */
  raw: PreflightClient
}

export interface CliDeps {
  createClients(region: string | undefined): CliClients
  /** Normal output line (stdout). */
  stdout(line: string): void
  /** Log / error line (stderr). */
  stderr(line: string): void
}

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

function printCheckSummary(summary: PostTagCheckSummary, out: (line: string) => void): void {
  const count = (kind: string) => summary.mismatches.filter((m) => m.kind === kind).length
  out(`mode:              ${summary.apply ? 'apply' : 'dry-run'}`)
  out(`posts scanned:     ${summary.postsScanned}`)
  out(`PostTag scanned:   ${summary.postTagRowsScanned}`)
  out(`mismatches:        ${summary.mismatches.length}`)
  out(`  stale:           ${count('stale')}`)
  out(`  content:         ${count('content')}`)
  out(`  missing:         ${count('missing')}`)
  if (summary.apply) {
    out(`posts repaired:    ${summary.repaired}`)
    out(`failed:            ${summary.failed.length}`)
    out(`remaining:         ${summary.remaining?.length ?? 0}`)
  }
}

function printPreflight(p: PublishedAtPreflight, out: (line: string) => void): void {
  out(
    `preflight: table=${p.tableStatus ?? 'unknown'} ` +
      (p.index
        ? `${p.index.name}=${p.index.status ?? 'unknown'} backfilling=${p.index.backfilling}`
        : 'byStatusSorted=missing')
  )
  for (const problem of p.problems) out(`preflight problem: ${problem}`)
}

const COMPLETION_NOTE =
  'Note: a dry-run reporting nothing to change does not by itself prove completion. ' +
  'Follow the RUNBOOK procedure (stop writers, drain the stream / trusted queue / DLQ, ' +
  'then --check-post-tags reporting zero mismatches).'

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        table: { type: 'string' },
        'post-tag-table': { type: 'string' },
        'check-post-tags': { type: 'boolean', default: false },
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
    deps.stderr(`${(err as Error).message}\n\n${USAGE}`)
    return 2
  }

  if (values.help) {
    deps.stdout(USAGE)
    return 0
  }
  if (!values.table) {
    deps.stderr(`--table is required\n\n${USAGE}`)
    return 2
  }
  const checkMode = values['check-post-tags']
  if (checkMode && !values['post-tag-table']) {
    deps.stderr(`--post-tag-table is required with --check-post-tags\n\n${USAGE}`)
    return 2
  }
  if (!checkMode && values['post-tag-table']) {
    deps.stderr(`--post-tag-table is only used with --check-post-tags\n\n${USAGE}`)
    return 2
  }
  let maxWritesPerSecond = 10
  if (values['max-writes-per-second'] !== undefined) {
    maxWritesPerSecond = Number(values['max-writes-per-second'])
    if (!Number.isFinite(maxWritesPerSecond) || maxWritesPerSecond <= 0) {
      deps.stderr('--max-writes-per-second must be a positive number')
      return 2
    }
  }

  // With --json, stdout carries only the summary; everything else → stderr.
  const out = values.json ? deps.stderr : deps.stdout
  const region = values.region ? ` (${values.region})` : ''
  const clients = deps.createClients(values.region)

  if (checkMode) {
    const postTagTable = values['post-tag-table']!
    out(
      values.apply
        ? `WARNING: --apply will rebuild mismatched rows in ${postTagTable}${region} from ${values.table}.`
        : `Checking ${postTagTable} against ${values.table}${region}: no writes will be made (pass --apply to repair).`
    )
    let summary: PostTagCheckSummary
    try {
      summary = await runPostTagCheck({
        client: clients.doc,
        postTable: values.table,
        postTagTable,
        apply: values.apply,
        maxWritesPerSecond,
        log: out,
      })
    } catch (err) {
      console.error('[check-post-tags] check aborted:', err)
      return 1
    }
    if (values.json) deps.stdout(JSON.stringify(summary, null, 2))
    else printCheckSummary(summary, out)

    if (summary.failed.length > 0) {
      out(`${summary.failed.length} post(s) could not be repaired; see the errors above.`)
      return 1
    }
    const left = summary.apply ? (summary.remaining?.length ?? 0) : summary.mismatches.length
    if (left > 0) {
      out(
        summary.apply
          ? `${left} mismatch(es) remain after the repair. Were writers stopped and the queue drained? Re-run.`
          : `${left} mismatch(es) found. Re-run with --apply to repair.`
      )
      return 1
    }
    return 0
  }

  let preflight: PublishedAtPreflight
  try {
    preflight = await checkPublishedAtPreflight(clients.raw, values.table)
  } catch (err) {
    console.error('[migrate-published-at] preflight DescribeTable failed:', err)
    preflight = {
      ok: false,
      tableStatus: null,
      index: null,
      problems: [`DescribeTable failed: ${String(err)}`],
    }
  }
  printPreflight(preflight, out)

  if (values.apply) {
    if (!preflight.ok) {
      deps.stderr(
        'Refusing --apply: the preflight check failed (see the problems above). ' +
          'Wait until the table and the byStatusSorted index are ACTIVE and backfilling has finished, then re-run.'
      )
      return 1
    }
    out(
      `WARNING: --apply will UPDATE rows in table ${values.table}${region}.\n` +
        '  Each write is conditional on publishedAt / publishedAtSortKey still holding the scanned values;\n' +
        '  take a backup / enable PITR first. Run without --apply first and review the dry-run output.'
    )
  } else {
    if (!preflight.ok) {
      out(
        'The preflight check failed: --apply would be refused until the problems above are resolved.'
      )
    }
    out(`Dry-run against ${values.table}: no writes will be made (pass --apply to write).`)
  }

  let summary: PublishedAtMigrationSummary
  try {
    summary = await runPublishedAtMigration({
      client: clients.doc,
      tableName: values.table,
      apply: values.apply,
      maxWritesPerSecond,
      log: out,
    })
  } catch (err) {
    console.error('[migrate-published-at] migration aborted:', err)
    return 1
  }

  if (values.json) deps.stdout(JSON.stringify({ ...summary, preflight }, null, 2))
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
  out(COMPLETION_NOTE)
  return 0
}
