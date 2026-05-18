import * as p from '@clack/prompts'
import { execa } from 'execa'
import type { ParsedArgs } from './args.js'
import { resolveGithubToken, type DeployOptions } from './deploy.js'

/**
 * Fill in any unset deploy options interactively. Called from `main()`
 * after scaffolding when `--deploy` is set; CI-friendly flag-only
 * invocations skip every prompt because their values are already
 * supplied on argv.
 */

async function detectGithubLogin(): Promise<string | undefined> {
  try {
    const { stdout } = await execa('gh', ['api', 'user', '--jq', '.login'], { reject: false })
    const trimmed = stdout?.trim()
    return trimmed || undefined
  } catch {
    return undefined
  }
}

async function detectAwsRegion(): Promise<string | undefined> {
  if (process.env.AWS_REGION?.trim()) return process.env.AWS_REGION.trim()
  if (process.env.AWS_DEFAULT_REGION?.trim()) return process.env.AWS_DEFAULT_REGION.trim()
  try {
    const { stdout } = await execa('aws', ['configure', 'get', 'region'], { reject: false })
    const trimmed = stdout?.trim()
    return trimmed || undefined
  } catch {
    return undefined
  }
}

export async function gatherDeployOptions(
  args: ParsedArgs,
  projectDir: string,
  projectName: string
): Promise<DeployOptions | null> {
  p.log.info('Configuring deploy (GitHub + Amplify Hosting)')

  // GitHub owner
  let githubOwner = args.githubOwner
  if (!githubOwner) {
    const detected = await detectGithubLogin()
    const answer = await p.text({
      message: 'GitHub owner (user or org)',
      placeholder: detected ?? 'your-github-username',
      defaultValue: detected ?? '',
      validate: (v) => (!v?.trim() ? 'GitHub owner is required' : undefined),
    })
    if (p.isCancel(answer)) {
      p.cancel('Cancelled.')
      return null
    }
    githubOwner = answer.trim()
  }

  // Repo visibility — only prompt when the flag wasn't explicit.
  // `--github-private` flips to true; otherwise default to public, but
  // the user can still pick at the prompt.
  let githubPrivate = args.githubPrivate
  if (!args.githubPrivate) {
    const choice = await p.select({
      message: 'Repository visibility',
      options: [
        { value: 'public', label: 'Public' },
        { value: 'private', label: 'Private' },
      ],
      initialValue: 'public',
    })
    if (p.isCancel(choice)) {
      p.cancel('Cancelled.')
      return null
    }
    githubPrivate = choice === 'private'
  }

  // GitHub token: flag → env → `gh auth token` → prompt.
  let githubToken = await resolveGithubToken(args.githubToken)
  if (!githubToken) {
    const answer = await p.password({
      message: 'GitHub token (needs `repo` scope) — or run `gh auth login` first',
      validate: (v) => (!v?.trim() ? 'Token is required' : undefined),
    })
    if (p.isCancel(answer)) {
      p.cancel('Cancelled.')
      return null
    }
    githubToken = answer.trim()
  }

  // AWS region
  let awsRegion = args.awsRegion
  if (!awsRegion) {
    const detected = await detectAwsRegion()
    const answer = await p.text({
      message: 'AWS region',
      placeholder: detected ?? 'us-east-1',
      defaultValue: detected ?? 'us-east-1',
    })
    if (p.isCancel(answer)) {
      p.cancel('Cancelled.')
      return null
    }
    awsRegion = answer.trim() || detected || 'us-east-1'
  }

  // Custom domain
  let domain = args.domain
  let subdomain = args.subdomain
  if (!domain) {
    const wantDomain = await p.confirm({
      message: 'Attach a custom domain?',
      initialValue: false,
    })
    if (p.isCancel(wantDomain)) {
      p.cancel('Cancelled.')
      return null
    }
    if (wantDomain) {
      const dom = await p.text({
        message: 'Domain (apex or subdomain, e.g. example.com or blog.example.com)',
        validate: (v) => {
          if (!v?.trim()) return 'Domain is required'
          if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v.trim())) return 'Looks invalid'
        },
      })
      if (p.isCancel(dom)) {
        p.cancel('Cancelled.')
        return null
      }
      domain = dom.trim()
      if (!subdomain) {
        const sub = await p.text({
          message: 'Subdomain prefix (leave blank for apex)',
          placeholder: '',
          defaultValue: '',
        })
        if (p.isCancel(sub)) {
          p.cancel('Cancelled.')
          return null
        }
        subdomain = sub.trim() || undefined
      }
    }
  }

  // Final confirm — unless skipped.
  if (!args.skipConfirm) {
    const proceed = await p.confirm({
      message:
        `Proceed?\n  GitHub: ${githubOwner}/${projectName} (${githubPrivate ? 'private' : 'public'})\n  Region: ${awsRegion}` +
        (domain ? `\n  Domain: ${subdomain ? `${subdomain}.` : ''}${domain}` : ''),
      initialValue: true,
    })
    if (p.isCancel(proceed) || !proceed) {
      p.cancel('Cancelled.')
      return null
    }
  }

  return {
    projectDir,
    projectName,
    githubOwner,
    githubPrivate,
    githubToken,
    awsProfile: args.awsProfile,
    awsRegion,
    domain,
    subdomain,
    skipConfirm: args.skipConfirm,
  }
}
