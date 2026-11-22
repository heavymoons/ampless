#!/usr/bin/env node
/**
 * `ampless-migrate-published-at` — CLI entry around
 * `runPublishedAtMigration` (./published-at.ts) and `runPostTagCheck`
 * (./post-tags-check.ts); argument handling lives in ./cli-main.ts. Dry-run
 * unless `--apply` is given. Credentials come from the default AWS provider
 * chain (AWS_PROFILE, env vars, SSO, ...).
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { runCli } from './cli-main.js'

runCli(process.argv.slice(2), {
  createClients(region) {
    const raw = new DynamoDBClient(region ? { region } : {})
    return { raw, doc: DynamoDBDocumentClient.from(raw) }
  },
  stdout: (line) => console.log(line),
  stderr: (line) => process.stderr.write(`${line}\n`),
}).then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    console.error('[migrate-published-at] unexpected error:', err)
    process.exitCode = 1
  }
)
