import { execa, type Options as ExecaOptions } from 'execa'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spinner, log } from '@clack/prompts'
import pc from 'picocolors'

/**
 * Deploy pipeline for `create-ampless --deploy`.
 *
 * Shells out to the user's existing `gh` and `aws` CLI tooling so we
 * leverage whatever auth / profile / region they already have configured
 * (no bundled SDKs). Each step is small + auditable, and partial-success
 * state is surfaced explicitly so the user can clean up after a failure
 * without silent leftover GitHub repos or Amplify apps.
 */

export interface DeployOptions {
  /** Absolute path to the just-scaffolded project. */
  projectDir: string
  projectName: string
  githubOwner: string
  githubPrivate: boolean
  /** Already-resolved token (flag → env → `gh auth token` → prompt). */
  githubToken: string
  awsProfile?: string
  awsRegion?: string
  /**
   * Custom domain. May be the registrable domain itself (`example.com`)
   * or an existing subdomain (`blog.example.com`). When the value
   * already contains a subdomain, the prefix is treated as the
   * Amplify "sub-domain" setting and the apex is the registrable root.
   */
  domain?: string
  /** Explicit subdomain prefix; if set, takes precedence over auto-split. */
  subdomain?: string
  skipConfirm: boolean
}

export interface DomainVerificationRecord {
  /** The DNS name that needs the CNAME (e.g. `blog.example.com`). */
  cname: string
  /** The CloudFront-style target Amplify wants the CNAME to point at. */
  target: string
}

export interface DeployResult {
  githubRepoUrl: string
  amplifyAppId: string
  /** Default Amplify-managed URL — `https://main.<appId>.amplifyapp.com`. */
  amplifyAppUrl: string
  /** Set when `--domain` was used. */
  domainUrl?: string
  /** Set when `--domain` was used and external DNS validation is required. */
  domainVerification?: DomainVerificationRecord[]
}

/**
 * Build spec written into the new project and used in
 * `aws amplify create-app --build-spec`. Stays the same content in
 * both places so subsequent pushes after manual edits are predictable.
 */
export const AMPLIFY_BUILD_SPEC = `version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npx ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID
        - npm run build
  artifacts:
    baseDirectory: .next
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
      - .next/cache/**/*
`

/**
 * Resolve a GitHub token using the documented fallback chain:
 *   1. explicit `--github-token` value (passed in via options arg)
 *   2. `GITHUB_TOKEN` env var
 *   3. `gh auth token` shell output
 *
 * Returns `undefined` if none yielded a value; the caller may then prompt
 * the user interactively.
 */
export async function resolveGithubToken(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | undefined> {
  if (explicit && explicit.trim()) return explicit.trim()

  const envToken = env.GITHUB_TOKEN
  if (envToken && envToken.trim()) return envToken.trim()

  try {
    const { stdout } = await execa('gh', ['auth', 'token'], { reject: false })
    const trimmed = stdout?.trim()
    if (trimmed) return trimmed
  } catch {
    // `gh` not installed or not authenticated — fall through.
  }

  return undefined
}

/**
 * Pull the registrable (eTLD+1) domain out of a possibly-subdomained
 * name. Used to decide which Route 53 hosted zone to look for and what
 * to pass to `aws amplify create-domain-association --domain-name`,
 * which always wants the registrable root.
 *
 * Handles the common multi-part public-suffix cases for the launch set
 * (`.co.uk`, `.co.jp`, `.com.au`, `.ne.jp`, `.or.jp`, etc.). For
 * domains outside this allowlist we fall back to the last two labels,
 * which is correct for `.com` / `.net` / `.io` / `.dev` style names.
 */
export function extractRegistrableDomain(domain: string): string {
  const labels = domain.replace(/\.$/, '').split('.')
  if (labels.length <= 2) return labels.join('.')

  const MULTI_PART_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'me.uk', 'gov.uk', 'ac.uk',
    'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ad.jp', 'gr.jp', 'lg.jp',
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
    'co.nz', 'net.nz', 'org.nz',
    'com.br', 'com.mx', 'com.cn', 'com.sg', 'com.hk', 'com.tw',
    'co.kr', 'or.kr',
    'co.in', 'co.id', 'co.za',
  ])

  const lastTwo = labels.slice(-2).join('.')
  if (MULTI_PART_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join('.')
  }
  return lastTwo
}

/**
 * Derive `{ registrable, subdomain }` from a `--domain` / `--subdomain`
 * pair. Explicit `--subdomain` always wins; otherwise we auto-split
 * the supplied name against the registrable suffix.
 *
 * Examples:
 *   domain=example.com, subdomain=undefined   → { example.com, '' }
 *   domain=example.com, subdomain=blog        → { example.com, 'blog' }
 *   domain=blog.example.com, subdomain=undef  → { example.com, 'blog' }
 */
export function splitDomain(
  domain: string,
  subdomain: string | undefined
): { registrable: string; subdomain: string } {
  const registrable = extractRegistrableDomain(domain)
  if (subdomain !== undefined) {
    return { registrable, subdomain }
  }
  if (domain === registrable) {
    return { registrable, subdomain: '' }
  }
  // domain is something like `blog.example.com`; strip the registrable
  // suffix (plus the joining dot) to get the prefix.
  const prefix = domain.slice(0, domain.length - registrable.length - 1)
  return { registrable, subdomain: prefix }
}

interface RunOpts extends ExecaOptions {
  /** Friendly name to surface in error messages. */
  step?: string
}

async function run(cmd: string, args: string[], opts: RunOpts = {}): Promise<string> {
  const { step, ...execaOpts } = opts
  try {
    const result = await execa(cmd, args, { stdio: 'pipe', ...execaOpts })
    return result.stdout?.toString() ?? ''
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; shortMessage?: string; message?: string }
    const detail = (e.stderr || e.stdout || e.shortMessage || e.message || String(err)).trim()
    const prefix = step ? `${step}: ` : ''
    throw new Error(`${prefix}${cmd} ${args.join(' ')}\n${detail}`)
  }
}

/**
 * Throw a helpful error if `cmd` (`gh` / `aws`) isn't on PATH.
 * Caller catches at the pipeline boundary so the user gets a single
 * "install this and re-run" message instead of a cryptic ENOENT.
 */
export async function ensureCommandExists(cmd: 'gh' | 'aws'): Promise<void> {
  try {
    await execa(cmd, ['--version'], { stdio: 'ignore' })
  } catch {
    const hint = cmd === 'gh'
      ? 'Install with `brew install gh` (or see https://cli.github.com/) then run `gh auth login`.'
      : 'Install with `brew install awscli` (or see https://aws.amazon.com/cli/) then run `aws configure`.'
    throw new Error(`Required command not found: ${cmd}\n${hint}`)
  }
}

function awsArgs(opts: DeployOptions, extra: string[]): string[] {
  const base: string[] = []
  if (opts.awsProfile) base.push('--profile', opts.awsProfile)
  if (opts.awsRegion) base.push('--region', opts.awsRegion)
  base.push(...extra)
  base.push('--output', 'json')
  return base
}

async function gitInitCommit(dir: string): Promise<void> {
  await run('git', ['init', '-b', 'main'], { cwd: dir, step: 'git init' })
  await run('git', ['add', '.'], { cwd: dir, step: 'git add' })
  await run(
    'git',
    ['commit', '-m', 'Initial scaffold (create-ampless)'],
    { cwd: dir, step: 'git commit' }
  )
}

async function ghRepoCreate(opts: DeployOptions): Promise<string> {
  const visibility = opts.githubPrivate ? '--private' : '--public'
  const name = `${opts.githubOwner}/${opts.projectName}`
  const out = await run(
    'gh',
    [
      'repo',
      'create',
      name,
      '--source',
      opts.projectDir,
      '--push',
      visibility,
      '--description',
      'Created by create-ampless',
    ],
    {
      cwd: opts.projectDir,
      step: 'gh repo create',
      env: { ...process.env, GH_TOKEN: opts.githubToken },
    }
  )
  // `gh repo create` prints the URL on stdout; pick the last https://github.com/... token.
  const match = out.match(/https:\/\/github\.com\/[^\s]+/g)
  if (match && match.length > 0) return match[match.length - 1]!.replace(/[.,]$/, '')
  return `https://github.com/${name}`
}

interface AmplifyApp {
  appId: string
  defaultDomain: string
}

async function amplifyCreateApp(opts: DeployOptions, repoUrl: string): Promise<AmplifyApp> {
  const out = await run(
    'aws',
    awsArgs(opts, [
      'amplify',
      'create-app',
      '--name', opts.projectName,
      '--repository', repoUrl,
      '--access-token', opts.githubToken,
      '--platform', 'WEB_COMPUTE',
      '--build-spec', AMPLIFY_BUILD_SPEC,
    ]),
    { step: 'aws amplify create-app' }
  )
  const parsed = JSON.parse(out) as { app?: { appId?: string; defaultDomain?: string } }
  const appId = parsed.app?.appId
  if (!appId) throw new Error('aws amplify create-app: missing app.appId in response')
  return {
    appId,
    defaultDomain: parsed.app?.defaultDomain ?? 'amplifyapp.com',
  }
}

async function amplifyCreateBranch(opts: DeployOptions, appId: string): Promise<void> {
  await run(
    'aws',
    awsArgs(opts, [
      'amplify',
      'create-branch',
      '--app-id', appId,
      '--branch-name', 'main',
      '--stage', 'PRODUCTION',
    ]),
    { step: 'aws amplify create-branch' }
  )
}

async function amplifyStartJob(opts: DeployOptions, appId: string): Promise<void> {
  await run(
    'aws',
    awsArgs(opts, [
      'amplify',
      'start-job',
      '--app-id', appId,
      '--branch-name', 'main',
      '--job-type', 'RELEASE',
    ]),
    { step: 'aws amplify start-job' }
  )
}

/**
 * Look up the Route 53 hosted zone for a registrable domain. Returns
 * the zone id (sans the `/hostedzone/` prefix) when the caller's
 * default AWS account / profile owns a zone whose `Name` exactly
 * matches `<registrable>.`. Returns `undefined` otherwise — that's
 * the "external DNS" case where the user has to add CNAMEs manually.
 */
async function findRoute53Zone(
  opts: DeployOptions,
  registrable: string
): Promise<string | undefined> {
  try {
    const out = await run(
      'aws',
      awsArgs(opts, [
        'route53',
        'list-hosted-zones-by-name',
        '--dns-name', registrable,
        '--max-items', '1',
      ]),
      { step: 'aws route53 list-hosted-zones-by-name' }
    )
    const parsed = JSON.parse(out) as { HostedZones?: { Name?: string; Id?: string }[] }
    const zones = parsed.HostedZones ?? []
    for (const z of zones) {
      if (z.Name && z.Name.replace(/\.$/, '') === registrable && z.Id) {
        return z.Id.replace('/hostedzone/', '')
      }
    }
  } catch {
    // Route53 may not be available or the user lacks permission — that's
    // fine, we just fall back to surfacing DNS records manually.
  }
  return undefined
}

async function amplifyCreateDomain(
  opts: DeployOptions,
  appId: string
): Promise<{ domainUrl: string; verification?: DomainVerificationRecord[] }> {
  const { registrable, subdomain } = splitDomain(opts.domain!, opts.subdomain)
  const fullName = subdomain ? `${subdomain}.${registrable}` : registrable

  const route53Zone = await findRoute53Zone(opts, registrable)
  if (route53Zone) {
    log.info(
      `Route 53 hosted zone detected for ${pc.cyan(registrable)} — Amplify will auto-create DNS records once ACM validates.`
    )
  }

  const out = await run(
    'aws',
    awsArgs(opts, [
      'amplify',
      'create-domain-association',
      '--app-id', appId,
      '--domain-name', registrable,
      '--sub-domain-settings', `prefix=${subdomain},branchName=main`,
    ]),
    { step: 'aws amplify create-domain-association' }
  )

  interface DomainAssociation {
    domainAssociation?: {
      certificateVerificationDNSRecord?: string
      subDomains?: {
        subDomainSetting?: { prefix?: string }
        dnsRecord?: string
        verified?: boolean
      }[]
    }
  }
  const parsed = JSON.parse(out) as DomainAssociation
  const verification: DomainVerificationRecord[] = []

  const certRecord = parsed.domainAssociation?.certificateVerificationDNSRecord
  if (certRecord) {
    // AWS returns the cert DNS record as a single space-delimited string like
    // `_abc.example.com. CNAME _xyz.acm-validations.aws.`
    const parts = certRecord.trim().split(/\s+/)
    if (parts.length >= 3) {
      verification.push({
        cname: parts[0]!.replace(/\.$/, ''),
        target: parts.slice(2).join(' ').replace(/\.$/, ''),
      })
    }
  }

  for (const sd of parsed.domainAssociation?.subDomains ?? []) {
    if (!sd.dnsRecord) continue
    const parts = sd.dnsRecord.trim().split(/\s+/)
    // dnsRecord shape: `<prefix> CNAME <cloudfront-target>`
    if (parts.length >= 3) {
      const prefix = sd.subDomainSetting?.prefix ?? ''
      const cname = prefix ? `${prefix}.${registrable}` : registrable
      verification.push({
        cname,
        target: parts.slice(2).join(' ').replace(/\.$/, ''),
      })
    }
  }

  return {
    domainUrl: `https://${fullName}`,
    verification: route53Zone ? undefined : (verification.length > 0 ? verification : undefined),
  }
}

/** Run the full deploy pipeline. Errors include partial-progress hints. */
export async function runDeploy(opts: DeployOptions): Promise<DeployResult> {
  await ensureCommandExists('gh')
  await ensureCommandExists('aws')

  // Always write the build spec into the project so subsequent pushes
  // (with no --deploy) match what Amplify was created with.
  await writeFile(resolve(opts.projectDir, 'amplify.yml'), AMPLIFY_BUILD_SPEC, 'utf-8')

  const created: { repoUrl?: string; appId?: string } = {}

  const fail = (step: string, cause: unknown): never => {
    const msg = cause instanceof Error ? cause.message : String(cause)
    const cleanup: string[] = []
    if (created.appId) {
      cleanup.push(
        `  - Amplify app: ${created.appId} (delete: aws amplify delete-app --app-id ${created.appId}${opts.awsProfile ? ` --profile ${opts.awsProfile}` : ''}${opts.awsRegion ? ` --region ${opts.awsRegion}` : ''})`
      )
    }
    if (created.repoUrl) {
      cleanup.push(
        `  - GitHub repo: ${created.repoUrl} (delete: gh repo delete ${opts.githubOwner}/${opts.projectName} --yes)`
      )
    }
    const cleanupBlock = cleanup.length > 0
      ? `\nCreated so far:\n${cleanup.join('\n')}\n\nRe-run after cleaning up.`
      : ''
    throw new Error(`Deploy failed at: ${step}\n${msg}${cleanupBlock}`)
  }

  let s = spinner()
  s.start('git init + initial commit')
  try {
    await gitInitCommit(opts.projectDir)
    s.stop('git: committed initial scaffold')
  } catch (err) {
    s.stop('git: failed')
    fail('git init / commit', err)
  }

  s = spinner()
  s.start('Creating GitHub repo + pushing')
  try {
    created.repoUrl = await ghRepoCreate(opts)
    s.stop(`GitHub: ${created.repoUrl}`)
  } catch (err) {
    s.stop('GitHub: failed')
    fail('gh repo create', err)
  }

  let app: AmplifyApp
  s = spinner()
  s.start('Creating Amplify Hosting app')
  try {
    app = await amplifyCreateApp(opts, created.repoUrl!)
    created.appId = app.appId
    s.stop(`Amplify app: ${app.appId}`)
  } catch (err) {
    s.stop('Amplify create-app: failed')
    return fail('aws amplify create-app', err)
  }

  s = spinner()
  s.start('Creating main branch')
  try {
    await amplifyCreateBranch(opts, app.appId)
    s.stop('Amplify branch: main')
  } catch (err) {
    s.stop('Amplify create-branch: failed')
    fail('aws amplify create-branch', err)
  }

  s = spinner()
  s.start('Starting first deployment')
  try {
    await amplifyStartJob(opts, app.appId)
    s.stop('Amplify: first job started')
  } catch (err) {
    s.stop('Amplify start-job: failed')
    fail('aws amplify start-job', err)
  }

  const amplifyAppUrl = `https://main.${app.appId}.${app.defaultDomain}`
  const result: DeployResult = {
    githubRepoUrl: created.repoUrl!,
    amplifyAppId: app.appId,
    amplifyAppUrl,
  }

  if (opts.domain) {
    s = spinner()
    s.start(`Associating custom domain ${opts.domain}`)
    try {
      const dom = await amplifyCreateDomain(opts, app.appId)
      result.domainUrl = dom.domainUrl
      result.domainVerification = dom.verification
      s.stop(`Custom domain queued: ${opts.domain}`)
    } catch (err) {
      s.stop('Custom domain: failed')
      // Domain failure is non-fatal — the app itself is live. Surface
      // the error but still return the partial result so the user has
      // their Amplify URL.
      const msg = err instanceof Error ? err.message : String(err)
      log.warn(`Custom domain step failed:\n${msg}`)
    }
  }

  return result
}
