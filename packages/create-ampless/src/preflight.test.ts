import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.mock must be hoisted; expose a mutable handler list each test can
// reset, and have the mocked `execa` consult it.
type ExecaCall = { cmd: string; args: string[] }
type ExecaResponse = { exitCode: number; stdout: string; stderr: string }
type Handler = (call: ExecaCall) => ExecaResponse | undefined

const handlers: Handler[] = []
const calls: ExecaCall[] = []

vi.mock('execa', () => ({
  execa: async (cmd: string, args: string[]) => {
    const call: ExecaCall = { cmd, args }
    calls.push(call)
    for (const h of handlers) {
      const r = h(call)
      if (r) return r
    }
    // Default to success with empty stdout — keeps unconfigured tests
    // from accidentally returning "missing" for unrelated checks.
    return { exitCode: 0, stdout: '', stderr: '' }
  },
}))

// Import AFTER vi.mock so the SUT picks up the mock.
import {
  runPreflight,
  formatPreflightReport,
  AMPLIFY_BACKEND_POLICY_ARN,
} from './preflight.js'
import type { DeployOptions } from './deploy.js'

function makeOpts(overrides: Partial<DeployOptions> = {}): DeployOptions {
  return {
    projectDir: '/tmp/test-site',
    projectName: 'test-site',
    githubOwner: 'octocat',
    githubPrivate: false,
    githubToken: 'gh_test',
    awsRegion: 'ap-northeast-1',
    skipConfirm: true,
    ...overrides,
  }
}

beforeEach(() => {
  handlers.length = 0
  calls.length = 0
})

/** Convenience: register a handler matching on a substring of the joined argv. */
function on(matcher: (call: ExecaCall) => boolean, response: ExecaResponse): void {
  handlers.push((c) => (matcher(c) ? response : undefined))
}

function joined(c: ExecaCall): string {
  return [c.cmd, ...c.args].join(' ')
}

/**
 * Default-happy-path handler set. Tests override specific checks by adding
 * a more-specific handler before calling installHappyDefaults() (handlers
 * are tried in order, first match wins).
 */
function installHappyDefaults(): void {
  // gh --version → installed
  on((c) => c.cmd === 'gh' && c.args[0] === '--version', {
    exitCode: 0,
    stdout: 'gh version 2.40.0',
    stderr: '',
  })
  // gh auth status → logged in with repo scope
  on((c) => c.cmd === 'gh' && c.args[0] === 'auth' && c.args[1] === 'status', {
    exitCode: 0,
    stdout: '',
    stderr:
      "github.com\n  ✓ Logged in to github.com as octocat\n  - Token scopes: 'gist', 'read:org', 'repo'",
  })
  // gh repo view → repo does NOT exist
  on((c) => c.cmd === 'gh' && c.args[0] === 'repo' && c.args[1] === 'view', {
    exitCode: 1,
    stdout: '',
    stderr: 'GraphQL: Could not resolve to a Repository',
  })
  // aws --version
  on((c) => c.cmd === 'aws' && c.args.includes('--version'), {
    exitCode: 0,
    stdout: 'aws-cli/2.0',
    stderr: '',
  })
  // aws sts get-caller-identity
  on((c) => joined(c).includes('sts get-caller-identity'), {
    exitCode: 0,
    stdout: JSON.stringify({ Account: '123456789012', Arn: 'arn:aws:iam::123:user/x' }),
    stderr: '',
  })
  // aws amplify list-apps with name filter → empty
  on((c) => joined(c).includes('amplify list-apps'), {
    exitCode: 0,
    stdout: '[]',
    stderr: '',
  })
  // aws ssm get-parameter for CDK bootstrap → exists
  on((c) => joined(c).includes('/cdk-bootstrap/hnb659fds/version'), {
    exitCode: 0,
    stdout: JSON.stringify({ Parameter: { Value: '20' } }),
    stderr: '',
  })
  // aws iam list-roles → one matching role with trust + attached policy
  on((c) => joined(c).includes('iam list-roles'), {
    exitCode: 0,
    stdout: JSON.stringify({
      Roles: [
        {
          RoleName: 'AmplifyDeployBackend',
          Arn: 'arn:aws:iam::123456789012:role/AmplifyDeployBackend',
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { Service: 'amplify.amazonaws.com' },
                Action: 'sts:AssumeRole',
              },
            ],
          },
        },
      ],
    }),
    stderr: '',
  })
  on((c) => joined(c).includes('iam list-attached-role-policies'), {
    exitCode: 0,
    stdout: JSON.stringify({
      AttachedPolicies: [{ PolicyArn: AMPLIFY_BACKEND_POLICY_ARN, PolicyName: 'X' }],
    }),
    stderr: '',
  })
  // route53: zone exists for `example.com.` — only consulted when --domain is set.
  on((c) => joined(c).includes('route53 list-hosted-zones-by-name'), {
    exitCode: 0,
    stdout: JSON.stringify({ HostedZones: [{ Name: 'example.com.', Id: '/hostedzone/Z1' }] }),
    stderr: '',
  })
}

describe('runPreflight — happy path', () => {
  it('returns zero problems and a resolution', async () => {
    installHappyDefaults()
    const result = await runPreflight(makeOpts())
    expect(result.problems).toEqual([])
    expect(result.resolution).toBeDefined()
    expect(result.resolution!.awsAccount).toBe('123456789012')
    expect(result.resolution!.awsRegion).toBe('ap-northeast-1')
    expect(result.resolution!.iamServiceRoleArn).toBe(
      'arn:aws:iam::123456789012:role/AmplifyDeployBackend'
    )
    expect(result.resolution!.willCreateIamRole).toBe(false)
  })
})

describe('runPreflight — gh missing', () => {
  it('flags gh not installed and short-circuits gh auth', async () => {
    on((c) => c.cmd === 'gh' && c.args[0] === '--version', {
      exitCode: 127,
      stdout: '',
      stderr: 'command not found: gh',
    })
    installHappyDefaults()
    const result = await runPreflight(makeOpts())
    const ids = result.problems.map((p) => p.id)
    expect(ids).toContain('gh-not-installed')
    // we shouldn't have invoked gh auth status because gh was missing
    expect(calls.find((c) => c.cmd === 'gh' && c.args[0] === 'auth')).toBeUndefined()
  })
})

describe('runPreflight — gh missing repo scope', () => {
  it('flags missing scope when output omits repo', async () => {
    on((c) => c.cmd === 'gh' && c.args[0] === 'auth' && c.args[1] === 'status', {
      exitCode: 0,
      stdout: '',
      stderr: "Token scopes: 'gist', 'read:org'",
    })
    installHappyDefaults()
    const result = await runPreflight(makeOpts())
    const ids = result.problems.map((p) => p.id)
    expect(ids).toContain('gh-missing-repo-scope')
  })
})

describe('runPreflight — github repo already exists', () => {
  it('flags repo collision', async () => {
    on((c) => c.cmd === 'gh' && c.args[0] === 'repo' && c.args[1] === 'view', {
      exitCode: 0,
      stdout: 'octocat/test-site',
      stderr: '',
    })
    installHappyDefaults()
    const result = await runPreflight(makeOpts())
    expect(result.problems.map((p) => p.id)).toContain('github-repo-exists')
  })

  it('allows the existing repo in mount mode', async () => {
    on((c) => c.cmd === 'gh' && c.args[0] === 'repo' && c.args[1] === 'view', {
      exitCode: 0,
      stdout: 'octocat/test-site',
      stderr: '',
    })
    installHappyDefaults()
    const result = await runPreflight(makeOpts(), { mountMode: true })
    expect(result.problems.map((p) => p.id)).not.toContain('github-repo-exists')
    // We also shouldn't have wasted a `gh repo view` call (preflight skips it).
    expect(
      calls.find((c) => c.cmd === 'gh' && c.args[0] === 'repo' && c.args[1] === 'view')
    ).toBeUndefined()
  })
})

describe('runPreflight — aws credentials missing', () => {
  it('flags credentials and skips downstream aws checks', async () => {
    on((c) => joined(c).includes('sts get-caller-identity'), {
      exitCode: 255,
      stdout: '',
      stderr: 'Unable to locate credentials',
    })
    installHappyDefaults()
    const result = await runPreflight(makeOpts())
    const ids = result.problems.map((p) => p.id)
    expect(ids).toContain('aws-credentials-missing')
    // No follow-on aws calls (no amplify list-apps, etc.)
    expect(calls.find((c) => joined(c).includes('amplify list-apps'))).toBeUndefined()
    expect(calls.find((c) => joined(c).includes('iam list-roles'))).toBeUndefined()
  })
})

describe('runPreflight — amplify name collision', () => {
  it('flags taken app name', async () => {
    on((c) => joined(c).includes('amplify list-apps'), {
      exitCode: 0,
      stdout: JSON.stringify([{ name: 'test-site' }]),
      stderr: '',
    })
    installHappyDefaults()
    const result = await runPreflight(makeOpts())
    expect(result.problems.map((p) => p.id)).toContain('amplify-app-name-taken')
  })
})

describe('runPreflight — CDK not bootstrapped', () => {
  it('flags missing bootstrap stack with the bootstrap command', async () => {
    on((c) => joined(c).includes('/cdk-bootstrap/hnb659fds/version'), {
      exitCode: 255,
      stdout: '',
      stderr: 'ParameterNotFound',
    })
    installHappyDefaults()
    const result = await runPreflight(makeOpts())
    const problem = result.problems.find((p) => p.id === 'cdk-not-bootstrapped')
    expect(problem).toBeDefined()
    expect(problem!.remediation.some((r) => r.includes('ap-northeast-1'))).toBe(true)
    expect(problem!.remediation.some((r) => r.includes('123456789012'))).toBe(true)
  })
})

describe('runPreflight — IAM role resolution', () => {
  it('uses --iam-service-role when supplied and the role exists', async () => {
    on((c) => joined(c).includes('iam get-role'), {
      exitCode: 0,
      stdout: JSON.stringify({ Role: { Arn: 'arn:aws:iam::1:role/Foo' } }),
      stderr: '',
    })
    // Override list-roles to return nothing — to make sure we DON'T fall back
    on((c) => joined(c).includes('iam list-roles'), {
      exitCode: 0,
      stdout: JSON.stringify({ Roles: [] }),
      stderr: '',
    })
    installHappyDefaults()
    const result = await runPreflight(makeOpts(), {
      iamServiceRoleArn: 'arn:aws:iam::1:role/Foo',
    })
    expect(result.problems).toEqual([])
    expect(result.resolution!.iamServiceRoleArn).toBe('arn:aws:iam::1:role/Foo')
    expect(result.resolution!.willCreateIamRole).toBe(false)
  })

  it('errors when --iam-service-role role does not exist', async () => {
    on((c) => joined(c).includes('iam get-role'), {
      exitCode: 255,
      stdout: '',
      stderr: 'NoSuchEntity',
    })
    installHappyDefaults()
    const result = await runPreflight(makeOpts(), {
      iamServiceRoleArn: 'arn:aws:iam::1:role/Missing',
    })
    expect(result.problems.map((p) => p.id)).toContain('iam-service-role-not-found')
  })

  it('passes pre-flight with willCreate when --create-iam-role is set', async () => {
    on((c) => joined(c).includes('iam list-roles'), {
      exitCode: 0,
      stdout: JSON.stringify({ Roles: [] }),
      stderr: '',
    })
    installHappyDefaults()
    const result = await runPreflight(makeOpts(), { createIamRole: true })
    expect(result.problems).toEqual([])
    expect(result.resolution!.willCreateIamRole).toBe(true)
    expect(result.resolution!.iamServiceRoleArn).toBeUndefined()
  })

  it('emits iam-service-role-missing when nothing is configured + nothing found', async () => {
    on((c) => joined(c).includes('iam list-roles'), {
      exitCode: 0,
      stdout: JSON.stringify({ Roles: [] }),
      stderr: '',
    })
    installHappyDefaults()
    const result = await runPreflight(makeOpts())
    const missing = result.problems.find((p) => p.id === 'iam-service-role-missing')
    expect(missing).toBeDefined()
    expect(missing!.remediation.join('\n')).toMatch(/--create-iam-role/)
    expect(missing!.remediation.join('\n')).toMatch(/--iam-service-role/)
  })

  it('handles URL-encoded AssumeRolePolicyDocument', async () => {
    // Some aws CLI versions return the trust policy as URL-encoded JSON.
    const trust = encodeURIComponent(
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 'amplify.amazonaws.com' },
            Action: 'sts:AssumeRole',
          },
        ],
      })
    )
    on((c) => joined(c).includes('iam list-roles'), {
      exitCode: 0,
      stdout: JSON.stringify({
        Roles: [
          {
            RoleName: 'EncodedRole',
            Arn: 'arn:aws:iam::1:role/EncodedRole',
            AssumeRolePolicyDocument: trust,
          },
        ],
      }),
      stderr: '',
    })
    on((c) => joined(c).includes('iam list-attached-role-policies'), {
      exitCode: 0,
      stdout: JSON.stringify({
        AttachedPolicies: [{ PolicyArn: AMPLIFY_BACKEND_POLICY_ARN }],
      }),
      stderr: '',
    })
    installHappyDefaults()
    const result = await runPreflight(makeOpts())
    expect(result.problems).toEqual([])
    expect(result.resolution!.iamServiceRoleArn).toBe('arn:aws:iam::1:role/EncodedRole')
  })
})

describe('runPreflight — Route 53 zone check', () => {
  it('skips when no --domain is set', async () => {
    installHappyDefaults()
    const result = await runPreflight(makeOpts())
    expect(calls.find((c) => joined(c).includes('route53 list-hosted-zones-by-name'))).toBeUndefined()
    expect(result.problems).toEqual([])
  })

  it('flags missing zone when domain is set', async () => {
    on((c) => joined(c).includes('route53 list-hosted-zones-by-name'), {
      exitCode: 0,
      stdout: JSON.stringify({ HostedZones: [] }),
      stderr: '',
    })
    installHappyDefaults()
    const result = await runPreflight(makeOpts({ domain: 'example.com' }))
    expect(result.problems.map((p) => p.id)).toContain('route53-zone-missing')
  })
})

describe('formatPreflightReport', () => {
  it('renders a clear report with bullets and remediation', () => {
    const report = formatPreflightReport([
      {
        id: 'iam-service-role-missing',
        message: 'No Amplify Hosting service role found.',
        remediation: [
          'Either pass --iam-service-role <arn> pointing at an existing role,',
          'or let create-ampless build one for you with --create-iam-role.',
        ],
      },
      {
        id: 'cdk-not-bootstrapped',
        message: 'CDK is not bootstrapped in region ap-northeast-1.',
        remediation: ['Run: npx cdk bootstrap aws://123456789012/ap-northeast-1'],
      },
    ])
    // Strip ANSI for a stable snapshot.
    const stripAnsi = (s: string) => s.replace(/\[[0-9;]*m/g, '')
    expect(stripAnsi(report)).toMatchInlineSnapshot(`
      "✗ create-ampless --deploy: prerequisites missing

        ✗ No Amplify Hosting service role found.
          Either pass --iam-service-role <arn> pointing at an existing role,
          or let create-ampless build one for you with --create-iam-role.

        ✗ CDK is not bootstrapped in region ap-northeast-1.
          Run: npx cdk bootstrap aws://123456789012/ap-northeast-1

      Fix the items above and re-run."
    `)
  })
})
