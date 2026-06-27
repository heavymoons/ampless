/**
 * Shared deploy types + pure helpers used by BOTH `deploy.ts` and
 * `preflight.ts`. Living here (rather than in `deploy.ts`) breaks the
 * import cycle: `deploy.ts` pulls the preflight report functions from
 * `preflight.ts`, while `preflight.ts` only needs the `DeployOptions`
 * shape and `extractRegistrableDomain` — both of which now sit in this
 * dependency-free leaf module.
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
  /** Optional explicit Amplify Hosting service role ARN (`--iam-service-role`). */
  iamServiceRoleArn?: string
  /** Opt into letting create-ampless provision the service role itself. */
  createIamRole?: boolean
  skipConfirm: boolean
  /**
   * Mount mode: the project directory already exists and may already be a
   * git repo. Skips scaffold-coupled assumptions and makes the
   * git-init/gh-create steps idempotent.
   */
  mount?: boolean
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
