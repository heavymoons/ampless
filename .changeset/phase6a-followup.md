---
"ampless": patch
"@ampless/admin": minor
"@ampless/backend": minor
"create-ampless": minor
---

Phase 6a v2.2 — file-based encryption key; `setup-encryption-key` CLI rewrite.

Supersedes v2 (Amplify `secret()` env var, sandbox-only) and v2.1 (SSM Parameter
Store, required AWS credentials for provisioning). v2.2 stores the key in
`amplify/secrets/encryption-key.ts` (adjacent to `amplify/backend.ts`); CDK
injects it as a Lambda env var at deploy time. No AWS credentials needed for
key provisioning. Works identically for sandbox and production.

**`@ampless/backend`** (minor):

- `DefineAmplessBackendOpts`: new optional `pluginSecretEncryptionKey?: string`
  field. When provided, CDK injects `PLUGIN_SECRET_ENCRYPTION_KEY` env var into
  both `processorTrusted` and `pluginSecretHandler` Lambdas.
- `backend.ts`: removed SSM `GetParameter` IAM grants and `AMPLESS_APPSYNC_API_ID`
  env var from both Lambdas. Added `addEnvironment('PLUGIN_SECRET_ENCRYPTION_KEY')`
  conditional on `pluginSecretEncryptionKey` being provided.
- `plugin-secret-handler.ts`: replaced `SSMClient` / `GetParameterCommand` with
  module-load-time decode of `process.env.PLUGIN_SECRET_ENCRYPTION_KEY`. Fail-fast
  throw if env var is absent or not 32 bytes.
- `processor-trusted.ts`: same — SSM fetch replaced with synchronous env-var read
  inside the `createProcessorTrustedHandler` factory. If the env var is absent,
  `ctx.secret()` now fails closed (`undefined`) with a warning.
- Removed `@aws-sdk/client-ssm` from `package.json` dependencies.
- Tests: SSM mock removed; env var set directly in `setEnv()`.

**`create-ampless`** (minor):

- `setup-encryption-key.ts`: complete rewrite — generates key locally, writes to
  `amplify/secrets/encryption-key.ts`. No SSM, no AWS credentials required.
  `--gitignore` flag adds the key file to `.gitignore`. Scaffold placeholders
  are overwritten without prompting; existing real 32-byte keys still require
  an explicit rotation confirmation.
- `upgrade.ts`: treats `amplify/secrets/encryption-key.ts` as seed-if-missing so
  older sites get the import target, while generated real keys are never
  overwritten by `update-ampless`.
- `args.ts`: added `gitignore: boolean` to `ParsedArgs`; `--gitignore` flag;
  updated HELP_TEXT for v2.2.
- Removed `@aws-sdk/client-ssm` from `package.json` dependencies.
- `setup-encryption-key.test.ts`: full rewrite for file-based behaviour (7 tests).

**`ampless`** (patch):

- New guard test: `encryption-key-import-guard.test.ts` — scans client code paths
  for any import of `amplify/secrets/encryption-key` and fails if found.
- `docs/architecture/08-plugin-architecture{,.ja}.md`: secret settings row updated
  with v2.2 threat model table; SSM references removed.
- `packages/ampless/docs/plugin-author-guide{,.ja}.md`: same updates + v2.2 threat
  model table; setup instructions updated to file-based flow.

**`@ampless/admin`** (minor — from prior commit in this PR):

- No new changes in this commit. Bump retained from the prior
  "4 review fixes + AES-GCM" commit.

**Templates**:

- `templates/_shared/amplify/backend.ts`: added import of
  `PLUGIN_SECRET_ENCRYPTION_KEY` from `./secrets/encryption-key.js`; passes it
  to `defineAmplessBackend({ pluginSecretEncryptionKey })`.
- `templates/_shared/amplify/secrets/encryption-key.ts`: placeholder stub with
  empty key value; replaced by `npx create-ampless setup-encryption-key` output.
- `templates/_shared/docs/plugin-author-guide{,.ja}.md`: same v2.2 threat model
  and setup instruction updates.
