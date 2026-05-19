/**
 * Tiny argv parser for the create-ampless CLI.
 *
 * Kept hand-rolled (no minimist / commander) so the package has zero
 * runtime deps beyond what scaffolding actually needs. Supported forms:
 *
 *   <projectName>                 — first positional arg
 *   --flag                        — boolean
 *   --flag value | --flag=value   — string-valued flag
 *
 * Unknown flags pass through into `unknown` so callers can warn /
 * ignore as appropriate. Anything before the first `--` style flag and
 * that isn't already consumed is treated as the project name.
 */

export interface ParsedArgs {
  projectName?: string
  siteName?: string
  themes?: string[]
  plugins?: string[]
  deploy: boolean
  mount: boolean
  upgrade: boolean
  copyTheme: boolean
  copyThemeSource?: string
  copyThemeTarget?: string
  dryRun: boolean
  noInstall: boolean
  githubOwner?: string
  githubPrivate: boolean
  githubToken?: string
  awsProfile?: string
  awsRegion?: string
  domain?: string
  subdomain?: string
  iamServiceRole?: string
  createIamRole: boolean
  skipConfirm: boolean
  help: boolean
  unknown: string[]
}

export const VALID_THEMES = ['blog', 'minimal', 'landing', 'corporate', 'docs', 'dads'] as const
export const VALID_PLUGINS = ['seo', 'rss', 'webhook'] as const

const STRING_FLAGS = new Set([
  '--site-name',
  '--themes',
  '--plugins',
  '--github-owner',
  '--github-token',
  '--aws-profile',
  '--aws-region',
  '--domain',
  '--subdomain',
  '--iam-service-role',
])

const BOOLEAN_FLAGS = new Set([
  '--deploy',
  '--mount',
  '--upgrade',
  '--dry-run',
  '--no-install',
  '--github-private',
  '--create-iam-role',
  '--skip-confirm',
  '--help',
  '-h',
])

export function parseDeployArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    deploy: false,
    mount: false,
    upgrade: false,
    copyTheme: false,
    dryRun: false,
    noInstall: false,
    githubPrivate: false,
    createIamRole: false,
    skipConfirm: false,
    help: false,
    unknown: [],
  }

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]!
    // Allow `--flag=value` syntax
    let token = raw
    let inlineValue: string | undefined
    const eq = raw.indexOf('=')
    if (raw.startsWith('--') && eq > 2) {
      token = raw.slice(0, eq)
      inlineValue = raw.slice(eq + 1)
    }

    if (BOOLEAN_FLAGS.has(token)) {
      switch (token) {
        case '--deploy':
          out.deploy = true
          break
        case '--mount':
          out.mount = true
          break
        case '--upgrade':
          out.upgrade = true
          break
        case '--dry-run':
          out.dryRun = true
          break
        case '--no-install':
          out.noInstall = true
          break
        case '--github-private':
          out.githubPrivate = true
          break
        case '--create-iam-role':
          out.createIamRole = true
          break
        case '--skip-confirm':
          out.skipConfirm = true
          break
        case '--help':
        case '-h':
          out.help = true
          break
      }
      continue
    }

    if (STRING_FLAGS.has(token)) {
      const value = inlineValue ?? argv[++i]
      if (value === undefined) {
        throw new Error(`Missing value for ${token}`)
      }
      switch (token) {
        case '--site-name':
          out.siteName = value
          break
        case '--themes': {
          const themes = value.split(',').map((t) => t.trim()).filter(Boolean)
          const invalid = themes.filter((t) => !(VALID_THEMES as readonly string[]).includes(t))
          if (invalid.length > 0) {
            throw new Error(
              `Invalid theme(s): ${invalid.join(', ')}. Valid values: ${VALID_THEMES.join(', ')}`
            )
          }
          out.themes = themes
          break
        }
        case '--plugins': {
          const plugins = value.split(',').map((p) => p.trim()).filter(Boolean)
          const invalid = plugins.filter((p) => !(VALID_PLUGINS as readonly string[]).includes(p))
          if (invalid.length > 0) {
            throw new Error(
              `Invalid plugin(s): ${invalid.join(', ')}. Valid values: ${VALID_PLUGINS.join(', ')}`
            )
          }
          out.plugins = plugins
          break
        }
        case '--github-owner':
          out.githubOwner = value
          break
        case '--github-token':
          out.githubToken = value
          break
        case '--aws-profile':
          out.awsProfile = value
          break
        case '--aws-region':
          out.awsRegion = value
          break
        case '--domain':
          out.domain = value
          break
        case '--subdomain':
          out.subdomain = value
          break
        case '--iam-service-role':
          out.iamServiceRole = value
          break
      }
      continue
    }

    if (raw.startsWith('-')) {
      out.unknown.push(raw)
      continue
    }

    // `upgrade` as first positional arg activates upgrade mode.
    if (raw === 'upgrade' && out.projectName === undefined) {
      out.upgrade = true
      continue
    }

    // `copy-theme <source> <target>` as first positional triggers the
    // theme-copy mode. The next two non-flag positionals are consumed
    // as source / target; anything beyond that falls through to unknown.
    if (raw === 'copy-theme' && out.projectName === undefined && !out.copyTheme) {
      out.copyTheme = true
      continue
    }
    if (out.copyTheme && out.copyThemeSource === undefined) {
      out.copyThemeSource = raw
      continue
    }
    if (out.copyTheme && out.copyThemeTarget === undefined) {
      out.copyThemeTarget = raw
      continue
    }

    // First non-flag positional → project name; further positionals are unknown.
    if (out.projectName === undefined) {
      out.projectName = raw
    } else {
      out.unknown.push(raw)
    }
  }

  return out
}

export const HELP_TEXT = `create-ampless — scaffold an ampless project

Usage:
  npx create-ampless@alpha <project-name> [options]
  npx create-ampless@alpha --mount [options]    # in an existing project dir
  npx create-ampless@alpha upgrade [options]    # in an existing project dir

Options:
  --site-name <name>          Site display name (default: "My Blog")
  --themes <list>             Comma-separated theme names to install
                              Valid: blog, minimal, landing, corporate, docs, dads
                              (default: blog)
  --plugins <list>            Comma-separated plugin names to install
                              Valid: seo, rss, webhook
                              (default: seo)
  --deploy                    Also create GitHub repo + Amplify Hosting app and
                              kick off the first deploy after scaffolding
  --mount                     Skip scaffolding and mount the CURRENT directory
                              onto a new GitHub repo + Amplify Hosting app.
                              Use after you've scaffolded and tested locally
                              with 'npx ampx sandbox' and now want to publish.
                              Implies --deploy. Scaffold flags (--site-name,
                              --themes, --plugins) are ignored.
  --github-owner <login>      GitHub owner (user or org). Defaults to the
                              authenticated 'gh' user
  --github-private            Create a private repo (default: public)
  --github-token <token>      GitHub token. Falls back to GITHUB_TOKEN env,
                              then 'gh auth token', then an interactive prompt
  --aws-profile <profile>     AWS profile name to pass to the aws CLI
  --aws-region <region>       AWS region (defaults to aws config / env)
  --domain <name>             Custom domain (apex or subdomain) to attach
  --subdomain <prefix>        Subdomain prefix for the domain (default: apex)
  --iam-service-role <arn>    Existing IAM role for Amplify Hosting (must trust
                              amplify.amazonaws.com and have
                              AdministratorAccess-Amplify attached)
  --create-iam-role           Let create-ampless provision the Amplify Hosting
                              service role (idempotent; defaults to role name
                              AmplifyDeployBackend)
  --skip-confirm              Skip all interactive prompts and use defaults /
                              flag values (for CI / automation)
  -h, --help                  Show this message

upgrade  Sync ampless package files / deps to latest alpha.
         Run inside an existing ampless project.

  --dry-run                   Show what would change without writing any files
  --no-install                Skip running pnpm/npm install after updating
                              package.json

copy-theme <source> <target>
         Copy a theme so the original stays managed by ampless and
         customisations live in the copy. Target must start with "my-"
         (the convention that flags it as user-owned, so upgrade leaves
         it alone). Run inside an existing ampless project.

         Example: npx create-ampless@alpha copy-theme blog my-blog
`
