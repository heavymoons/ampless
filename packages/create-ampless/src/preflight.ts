import { execa } from 'execa'
import { basename } from 'node:path'
import pc from 'picocolors'
import type { DeployOptions } from './deploy.js'
import { extractRegistrableDomain } from './deploy.js'

/**
 * Pre-flight checks for `create-ampless --deploy`.
 *
 * Runs BEFORE any side effect (git init, gh repo create, aws amplify
 * create-app, etc.) so a missing prerequisite never leaves the user with
 * half-created cloud resources to clean up. Every check is a read-only
 * shell-out to `gh` / `aws`. Failures are accumulated, not thrown — the
 * caller decides what to do with the report.
 */

export interface PreflightProblem {
  /** Short, stable id; useful for tests / programmatic handling. */
  id: string
  /** One-line user-facing summary of what's wrong. */
  message: string
  /** Copy-pasteable commands or short instructions to resolve it. */
  remediation: string[]
}

export interface PreflightResolution {
  /** Resolved Amplify Hosting service role ARN (only when already exists). */
  iamServiceRoleArn?: string
  /** True if `--create-iam-role` was passed and pre-flight is OK with that. */
  willCreateIamRole: boolean
  /** Captured from `aws sts get-caller-identity`. */
  awsAccount: string
  /** Effective region (from --aws-region or AWS env). */
  awsRegion: string
}

export interface PreflightResult {
  problems: PreflightProblem[]
  /** Populated only when `problems` is empty. */
  resolution?: PreflightResolution
}

/**
 * Default IAM role name we create when `--create-iam-role` is set. Picked to
 * match the wording in the AWS Amplify docs ("service role") and to be easy
 * to recognise in the IAM console.
 */
export const DEFAULT_AMPLIFY_ROLE_NAME = 'AmplifyDeployBackend'

/**
 * Managed policy required by Amplify Hosting builds that also deploy the
 * Amplify Gen 2 backend via `ampx pipeline-deploy`.
 *
 * Older AWS docs referenced `AmplifyBackendDeployFullAccess`, but that
 * policy doesn't exist in the registry. The correct managed policy for
 * Amplify Hosting service roles is `AdministratorAccess-Amplify`, which
 * includes CDK / SSM / S3 / Cognito / DynamoDB / Lambda etc. that
 * `ampx pipeline-deploy` needs.
 */
export const AMPLIFY_BACKEND_POLICY_ARN =
  'arn:aws:iam::aws:policy/AdministratorAccess-Amplify'

const TRUST_POLICY_JSON = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: { Service: 'amplify.amazonaws.com' },
      Action: 'sts:AssumeRole',
    },
  ],
})

// --- minimal exec helpers ---------------------------------------------------

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Run a command and return the result without throwing. Pre-flight inspects
 * exit codes / stderr to classify each check, so we never want to let execa
 * blow up on a non-zero exit.
 */
async function tryExec(cmd: string, args: string[]): Promise<ExecResult> {
  try {
    const r = await execa(cmd, args, { reject: false, stdio: 'pipe' })
    return {
      exitCode: r.exitCode ?? 0,
      stdout: r.stdout?.toString() ?? '',
      stderr: r.stderr?.toString() ?? '',
    }
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string }
    return {
      exitCode: 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? String(err),
    }
  }
}

function awsBaseArgs(opts: DeployOptions): string[] {
  const out: string[] = []
  if (opts.awsProfile) out.push('--profile', opts.awsProfile)
  if (opts.awsRegion) out.push('--region', opts.awsRegion)
  return out
}

function awsCmd(opts: DeployOptions, extra: string[]): string[] {
  return [...awsBaseArgs(opts), ...extra, '--output', 'json']
}

/** Project name → effective short name (matches deploy.ts logic). */
function shortName(opts: DeployOptions): string {
  return basename(opts.projectDir)
}

// --- individual check helpers ----------------------------------------------

async function checkGhInstalled(problems: PreflightProblem[]): Promise<boolean> {
  const r = await tryExec('gh', ['--version'])
  if (r.exitCode !== 0) {
    problems.push({
      id: 'gh-not-installed',
      message: 'GitHub CLI (`gh`) is not installed.',
      remediation: [
        'Install it (macOS: `brew install gh`; other OS: https://cli.github.com/),',
        'then run `gh auth login` to sign in.',
      ],
    })
    return false
  }
  return true
}

async function checkGhAuth(problems: PreflightProblem[]): Promise<boolean> {
  const r = await tryExec('gh', ['auth', 'status'])
  // `gh auth status` writes its human-readable summary to stderr on success
  // (exit 0) and on failure. Inspect both streams.
  const combined = `${r.stdout}\n${r.stderr}`
  if (r.exitCode !== 0 || /not logged in/i.test(combined)) {
    problems.push({
      id: 'gh-not-authenticated',
      message: 'GitHub CLI is not authenticated.',
      remediation: ['Run `gh auth login` and choose a method that includes the `repo` scope.'],
    })
    return false
  }
  // Look for the scopes line, e.g. `- Token scopes: 'gist', 'read:org', 'repo'`.
  const scopesMatch = combined.match(/Token scopes?:\s*([^\n]+)/i)
  if (!scopesMatch) {
    // Couldn't parse; surface a soft warning as a problem so the user re-auths
    // explicitly rather than us guessing.
    problems.push({
      id: 'gh-scopes-unknown',
      message: 'Could not determine GitHub token scopes from `gh auth status`.',
      remediation: ['Run `gh auth refresh -s repo` to ensure the `repo` scope is granted.'],
    })
    return false
  }
  const hasRepo = /(^|[^a-z])repo([^a-z]|$)/i.test(scopesMatch[1]!)
  if (!hasRepo) {
    problems.push({
      id: 'gh-missing-repo-scope',
      message: 'GitHub token is missing the `repo` scope.',
      remediation: ['Run `gh auth refresh -s repo` to add the `repo` scope to your token.'],
    })
    return false
  }
  return true
}

async function checkAwsInstalled(problems: PreflightProblem[]): Promise<boolean> {
  const r = await tryExec('aws', ['--version'])
  if (r.exitCode !== 0) {
    problems.push({
      id: 'aws-not-installed',
      message: 'AWS CLI (`aws`) is not installed.',
      remediation: [
        'Install it (macOS: `brew install awscli`; other OS: https://aws.amazon.com/cli/),',
        'then run `aws configure` to set credentials.',
      ],
    })
    return false
  }
  return true
}

interface AwsIdentity {
  account: string
  region: string
}

async function checkAwsCreds(
  opts: DeployOptions,
  problems: PreflightProblem[]
): Promise<AwsIdentity | undefined> {
  const r = await tryExec('aws', [...awsBaseArgs(opts), 'sts', 'get-caller-identity', '--output', 'json'])
  if (r.exitCode !== 0) {
    problems.push({
      id: 'aws-credentials-missing',
      message: 'AWS credentials are not configured (sts get-caller-identity failed).',
      remediation: [
        'Run `aws configure` (or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN),',
        opts.awsProfile
          ? `or check that profile \`${opts.awsProfile}\` exists in ~/.aws/config.`
          : 'or pass --aws-profile <name> if you use named profiles.',
      ],
    })
    return undefined
  }

  try {
    const parsed = JSON.parse(r.stdout) as { Account?: string }
    const account = parsed.Account
    if (!account) {
      problems.push({
        id: 'aws-identity-malformed',
        message: 'aws sts get-caller-identity did not return an Account field.',
        remediation: ['Re-run `aws sts get-caller-identity` manually to inspect the response.'],
      })
      return undefined
    }
    // Region: explicit flag wins; otherwise consult env / aws config.
    let region = opts.awsRegion
    if (!region) {
      const fromEnv = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim()
      if (fromEnv) region = fromEnv
    }
    if (!region) {
      const cfg = await tryExec('aws', [...awsBaseArgs(opts), 'configure', 'get', 'region'])
      const trimmed = cfg.stdout.trim()
      if (trimmed) region = trimmed
    }
    if (!region) {
      problems.push({
        id: 'aws-region-missing',
        message: 'AWS region is not set.',
        remediation: [
          'Pass --aws-region <name>, set AWS_REGION env var, or run `aws configure set region <name>`.',
        ],
      })
      return undefined
    }
    return { account, region }
  } catch (err) {
    problems.push({
      id: 'aws-identity-parse-failed',
      message: `Could not parse aws sts get-caller-identity response: ${err instanceof Error ? err.message : String(err)}`,
      remediation: ['Re-run `aws sts get-caller-identity` manually to inspect the response.'],
    })
    return undefined
  }
}

async function checkGithubRepoFree(
  opts: DeployOptions,
  owner: string,
  problems: PreflightProblem[]
): Promise<void> {
  if (!owner) return // owner is supplied by gatherDeployOptions; if absent something else already failed
  const name = `${owner}/${shortName(opts)}`
  const r = await tryExec('gh', ['repo', 'view', name])
  // Success → repo already exists (bad). Failure (most commonly stderr
  // containing "Could not resolve" / "not found") → free (good).
  if (r.exitCode === 0) {
    problems.push({
      id: 'github-repo-exists',
      message: `GitHub repo ${name} already exists.`,
      remediation: [
        'Pick a different project name, or delete the existing repo first:',
        `  gh repo delete ${name} --yes`,
      ],
    })
  }
}

async function checkAmplifyAppNameFree(
  opts: DeployOptions,
  problems: PreflightProblem[]
): Promise<void> {
  const name = shortName(opts)
  const r = await tryExec(
    'aws',
    awsCmd(opts, [
      'amplify',
      'list-apps',
      '--query',
      `apps[?name=='${name}']`,
    ])
  )
  if (r.exitCode !== 0) {
    // Surfacing this as a problem rather than silently skipping — if we
    // can't list apps we can't safely promise the name is free.
    problems.push({
      id: 'amplify-list-apps-failed',
      message: 'Could not list Amplify Hosting apps to check for a name collision.',
      remediation: [
        'Verify your IAM identity has `amplify:ListApps` permission, then re-run.',
        `Raw error: ${r.stderr.trim() || r.stdout.trim()}`,
      ],
    })
    return
  }
  try {
    const arr = JSON.parse(r.stdout) as unknown[]
    if (Array.isArray(arr) && arr.length > 0) {
      problems.push({
        id: 'amplify-app-name-taken',
        message: `Amplify Hosting already has an app named "${name}" in this region.`,
        remediation: [
          'Pick a different project name, or delete the existing app first:',
          `  aws amplify list-apps --query "apps[?name=='${name}'].appId" --output text${opts.awsProfile ? ` --profile ${opts.awsProfile}` : ''}${opts.awsRegion ? ` --region ${opts.awsRegion}` : ''}`,
          '  aws amplify delete-app --app-id <appId>',
        ],
      })
    }
  } catch {
    // Empty stdout is normal when there's no match; nothing to do.
  }
}

async function checkCdkBootstrap(
  opts: DeployOptions,
  identity: AwsIdentity,
  problems: PreflightProblem[]
): Promise<void> {
  const r = await tryExec(
    'aws',
    [
      ...awsBaseArgs(opts),
      'ssm',
      'get-parameter',
      '--name',
      '/cdk-bootstrap/hnb659fds/version',
      '--output',
      'json',
    ]
  )
  if (r.exitCode !== 0) {
    problems.push({
      id: 'cdk-not-bootstrapped',
      message: `CDK is not bootstrapped in region ${identity.region}.`,
      remediation: [
        `Run: npx cdk bootstrap aws://${identity.account}/${identity.region}`,
      ],
    })
  }
}

async function checkRoute53Zone(
  opts: DeployOptions,
  problems: PreflightProblem[]
): Promise<void> {
  if (!opts.domain) return
  const registrable = extractRegistrableDomain(opts.domain)
  const r = await tryExec(
    'aws',
    [
      ...awsBaseArgs(opts),
      'route53',
      'list-hosted-zones-by-name',
      '--dns-name',
      registrable,
      '--max-items',
      '1',
      '--output',
      'json',
    ]
  )
  if (r.exitCode !== 0) {
    // Could be a permissions issue. Surface as informational problem so
    // the user can decide whether to grant route53:ListHostedZonesByName
    // or accept the manual-CNAME flow.
    problems.push({
      id: 'route53-list-failed',
      message: `Could not query Route 53 for zone ${registrable}.`,
      remediation: [
        'Either grant `route53:ListHostedZonesByName` to your IAM identity,',
        'or be prepared to add the CNAME records Amplify prints manually after deploy.',
        `Raw error: ${r.stderr.trim() || r.stdout.trim()}`,
      ],
    })
    return
  }
  try {
    const parsed = JSON.parse(r.stdout) as { HostedZones?: { Name?: string }[] }
    const zones = parsed.HostedZones ?? []
    const found = zones.some(
      (z) => z.Name && z.Name.replace(/\.$/, '') === registrable
    )
    if (!found) {
      problems.push({
        id: 'route53-zone-missing',
        message: `No Route 53 hosted zone for ${registrable} found in this AWS account.`,
        remediation: [
          'Amplify will still issue an ACM certificate, but you will need to add',
          'the verification CNAMEs at your DNS provider manually. If you want',
          'auto-validation, create a hosted zone first:',
          `  aws route53 create-hosted-zone --name ${registrable} --caller-reference $(date +%s)${opts.awsProfile ? ` --profile ${opts.awsProfile}` : ''}`,
        ],
      })
    }
  } catch {
    // ignore parse errors — already reported above if it failed.
  }
}

// --- IAM service role resolution -------------------------------------------

interface IamServiceRoleArgs {
  explicitArn?: string
  willCreate: boolean
}

/**
 * Resolve which IAM service role pre-flight should treat as "the one
 * Amplify will use." Returns `{ arn }` when we have a concrete ARN to
 * forward to deploy. When the caller passed --create-iam-role, returns
 * `{ willCreate: true }` so deploy.ts knows to create it at deploy time.
 */
async function resolveIamServiceRole(
  opts: DeployOptions,
  args: IamServiceRoleArgs,
  problems: PreflightProblem[]
): Promise<{ arn?: string; willCreate: boolean }> {
  // (a) explicit --iam-service-role wins
  if (args.explicitArn) {
    const roleName = args.explicitArn.split('/').pop() ?? args.explicitArn
    const r = await tryExec(
      'aws',
      [
        ...awsBaseArgs(opts),
        'iam',
        'get-role',
        '--role-name',
        roleName,
        '--output',
        'json',
      ]
    )
    if (r.exitCode !== 0) {
      problems.push({
        id: 'iam-service-role-not-found',
        message: `IAM role ${args.explicitArn} not found or inaccessible.`,
        remediation: [
          'Verify the ARN is correct and the role exists:',
          `  aws iam get-role --role-name ${roleName}${opts.awsProfile ? ` --profile ${opts.awsProfile}` : ''}`,
        ],
      })
      return { willCreate: false }
    }
    return { arn: args.explicitArn, willCreate: false }
  }

  // (b) --create-iam-role: defer creation; pre-flight just notes intent.
  if (args.willCreate) {
    return { willCreate: true }
  }

  // (c) search for an existing matching role.
  const found = await findExistingAmplifyServiceRole(opts)
  if (found) {
    return { arn: found, willCreate: false }
  }

  problems.push({
    id: 'iam-service-role-missing',
    message: 'No Amplify Hosting service role found.',
    remediation: [
      'Either pass --iam-service-role <arn> pointing at an existing role,',
      'or let create-ampless build one for you with --create-iam-role.',
      '',
      'Alternatively, create one yourself:',
      `  aws iam create-role --role-name ${DEFAULT_AMPLIFY_ROLE_NAME} \\`,
      `    --assume-role-policy-document '${TRUST_POLICY_JSON}'`,
      `  aws iam attach-role-policy --role-name ${DEFAULT_AMPLIFY_ROLE_NAME} \\`,
      `    --policy-arn ${AMPLIFY_BACKEND_POLICY_ARN}`,
      `  # then re-run with: --iam-service-role $(aws iam get-role --role-name ${DEFAULT_AMPLIFY_ROLE_NAME} --query Role.Arn --output text)`,
    ],
  })
  return { willCreate: false }
}

interface IamListedRole {
  RoleName?: string
  Arn?: string
  AssumeRolePolicyDocument?: unknown
}

interface IamListRolesResponse {
  Roles?: IamListedRole[]
  IsTruncated?: boolean
  Marker?: string
}

interface IamAttachedPolicy {
  PolicyArn?: string
  PolicyName?: string
}

interface IamListAttachedPoliciesResponse {
  AttachedPolicies?: IamAttachedPolicy[]
}

function trustPolicyAllowsAmplify(doc: unknown): boolean {
  // AssumeRolePolicyDocument may be URL-encoded JSON (the default for
  // `aws iam list-roles`) OR already a parsed object (newer CLI versions).
  let parsed: unknown = doc
  if (typeof doc === 'string') {
    try {
      parsed = JSON.parse(decodeURIComponent(doc))
    } catch {
      try {
        parsed = JSON.parse(doc)
      } catch {
        return false
      }
    }
  }
  const stmts = (parsed as { Statement?: unknown })?.Statement
  const arr = Array.isArray(stmts) ? stmts : stmts ? [stmts] : []
  for (const stmt of arr) {
    const s = stmt as { Principal?: { Service?: string | string[] } }
    const svc = s.Principal?.Service
    if (typeof svc === 'string' && svc === 'amplify.amazonaws.com') return true
    if (Array.isArray(svc) && svc.includes('amplify.amazonaws.com')) return true
  }
  return false
}

async function findExistingAmplifyServiceRole(opts: DeployOptions): Promise<string | undefined> {
  let marker: string | undefined
  // Hard-cap pagination so we don't loop forever in pathological accounts.
  for (let page = 0; page < 20; page++) {
    const args = [
      ...awsBaseArgs(opts),
      'iam',
      'list-roles',
      '--max-items',
      '200',
      '--output',
      'json',
    ]
    if (marker) args.push('--starting-token', marker)
    const r = await tryExec('aws', args)
    if (r.exitCode !== 0) return undefined

    let parsed: IamListRolesResponse
    try {
      parsed = JSON.parse(r.stdout) as IamListRolesResponse
    } catch {
      return undefined
    }
    for (const role of parsed.Roles ?? []) {
      if (!role.RoleName || !role.Arn) continue
      if (!trustPolicyAllowsAmplify(role.AssumeRolePolicyDocument)) continue

      // Trust policy matches; verify the managed policy is attached.
      const pr = await tryExec(
        'aws',
        [
          ...awsBaseArgs(opts),
          'iam',
          'list-attached-role-policies',
          '--role-name',
          role.RoleName,
          '--output',
          'json',
        ]
      )
      if (pr.exitCode !== 0) continue
      try {
        const policies = JSON.parse(pr.stdout) as IamListAttachedPoliciesResponse
        const attached = (policies.AttachedPolicies ?? []).some(
          (p) => p.PolicyArn === AMPLIFY_BACKEND_POLICY_ARN
        )
        if (attached) return role.Arn
      } catch {
        continue
      }
    }
    if (!parsed.IsTruncated) break
    marker = parsed.Marker
    if (!marker) break
  }
  return undefined
}

// --- public entry point -----------------------------------------------------

export interface RunPreflightArgs {
  /** ARN supplied via `--iam-service-role`. */
  iamServiceRoleArn?: string
  /** Set when the user passed `--create-iam-role`. */
  createIamRole?: boolean
  /**
   * Mount mode: the user is mounting an existing project directory onto
   * a (possibly already-existing) GitHub repo. Relaxes the "repo must
   * not exist" check so users can re-use an existing repo.
   */
  mountMode?: boolean
}

export async function runPreflight(
  opts: DeployOptions,
  extra: RunPreflightArgs = {}
): Promise<PreflightResult> {
  const problems: PreflightProblem[] = []

  // 1. gh installed
  const hasGh = await checkGhInstalled(problems)
  // 2. gh authenticated with `repo` scope
  if (hasGh) await checkGhAuth(problems)
  // 3. aws installed
  const hasAws = await checkAwsInstalled(problems)
  // 4. aws credentials configured
  const identity = hasAws ? await checkAwsCreds(opts, problems) : undefined

  // 5. target GitHub repo does NOT exist (needs gh + auth, but we can still
  //    attempt — if gh isn't installed checkGhInstalled already flagged it).
  //    In --mount mode we allow the repo to already exist: deploy.ts will
  //    add the remote and push instead of creating it fresh.
  if (hasGh && opts.githubOwner && !extra.mountMode) {
    await checkGithubRepoFree(opts, opts.githubOwner, problems)
  }

  // 6/7/8/9 all require AWS reachable.
  if (identity) {
    await checkAmplifyAppNameFree(opts, problems)
    await checkCdkBootstrap(opts, identity, problems)
    await checkRoute53Zone(opts, problems)
  }

  let willCreateIamRole = false
  let iamServiceRoleArn: string | undefined
  if (identity) {
    const resolved = await resolveIamServiceRole(
      opts,
      { explicitArn: extra.iamServiceRoleArn, willCreate: extra.createIamRole === true },
      problems
    )
    willCreateIamRole = resolved.willCreate
    iamServiceRoleArn = resolved.arn
  }

  if (problems.length > 0) {
    return { problems }
  }

  return {
    problems,
    resolution: {
      iamServiceRoleArn,
      willCreateIamRole,
      awsAccount: identity!.account,
      awsRegion: identity!.region,
    },
  }
}

/**
 * Pretty-print a non-empty problem list. Format mirrors the spec — a
 * red-cross header per problem, indented remediation lines, blank line
 * between problems, and a trailing call-to-action.
 */
export function formatPreflightReport(problems: PreflightProblem[]): string {
  const lines: string[] = []
  lines.push(`${pc.red('✗')} create-ampless --deploy: prerequisites missing`)
  lines.push('')
  for (const p of problems) {
    lines.push(`  ${pc.red('✗')} ${p.message}`)
    for (const r of p.remediation) {
      lines.push(r ? `    ${r}` : '')
    }
    lines.push('')
  }
  lines.push('Fix the items above and re-run.')
  return lines.join('\n')
}

export function printPreflightReport(problems: PreflightProblem[]): void {
  // Write directly to stderr so the message survives any stdout redirection
  // the user might have for the spinner output.
  process.stderr.write(`${formatPreflightReport(problems)}\n`)
}
