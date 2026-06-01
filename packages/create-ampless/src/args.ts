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
  /**
   * `plugin <name>` subcommand (Phase 5): scaffold a new ampless
   * plugin. Two modes:
   *   - `--local` (default): writes `plugins/<name>/index.ts` inside
   *     the current ampless site (must be a valid ampless project).
   *   - `--standalone`: writes a complete npm package at
   *     `./<name>/` ready for `npm publish`.
   */
  createPlugin: boolean
  /**
   * `setup-encryption-key` subcommand: generates the AES-256-GCM
   * plugin secret encryption key and writes it to
   * `amplify/secrets/encryption-key.ts`. No AWS credentials required.
   */
  setupEncryptionKey: boolean
  /**
   * `--gitignore` flag for `setup-encryption-key`: if true, adds the
   * generated key file path to `.gitignore` so it is not committed.
   * Default false (commit-friendly — safe for private repos).
   */
  gitignore: boolean
  pluginName?: string
  /** 'local' (default) or 'standalone'. Resolved from --local / --standalone. */
  pluginMode?: 'local' | 'standalone'
  pluginTrustLevel?: 'untrusted' | 'trusted' | 'privileged'
  pluginCapabilities?: string[]
  pluginDescription?: string
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

/**
 * Trust levels a `plugin <name>` scaffold may declare. Mirrors the
 * `TrustLevel` union in `ampless`. Validation here is a allowlist —
 * an invalid value falls into `unknown` and the dispatcher errors.
 */
export const VALID_PLUGIN_TRUST_LEVELS = [
  'untrusted',
  'trusted',
  'privileged',
] as const

/**
 * Capabilities a `plugin <name>` scaffold may declare. Mirrors the
 * active members of the `PluginCapability` union in `ampless`. We
 * intentionally exclude reserved capabilities (`contentFields`,
 * `adminPage`, etc.) — the scaffold shouldn't produce a plugin that
 * declares a surface the runtime doesn't yet implement.
 */
export const VALID_PLUGIN_CAPABILITIES = [
  'publicHead',
  'publicBody',
  'metadata',
  'eventHooks',
  'adminSettings',
  'writePublicAsset',
  'schema',
] as const

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
  // Phase 5 `plugin <name>` flags
  '--trust-level',
  '--capabilities',
  '--description',
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
  // Phase 5 `plugin <name>` mode flags
  '--local',
  '--standalone',
  // setup-encryption-key flags
  '--gitignore',
])

export function parseDeployArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    deploy: false,
    mount: false,
    upgrade: false,
    copyTheme: false,
    createPlugin: false,
    setupEncryptionKey: false,
    gitignore: false,
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
        case '--local':
          if (out.pluginMode === 'standalone') {
            throw new Error('Cannot combine --local and --standalone')
          }
          out.pluginMode = 'local'
          break
        case '--standalone':
          if (out.pluginMode === 'local') {
            throw new Error('Cannot combine --local and --standalone')
          }
          out.pluginMode = 'standalone'
          break
        case '--gitignore':
          out.gitignore = true
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
        case '--trust-level': {
          if (
            !(VALID_PLUGIN_TRUST_LEVELS as readonly string[]).includes(value)
          ) {
            throw new Error(
              `Invalid --trust-level "${value}". Valid values: ${VALID_PLUGIN_TRUST_LEVELS.join(', ')}`
            )
          }
          out.pluginTrustLevel = value as ParsedArgs['pluginTrustLevel']
          break
        }
        case '--capabilities': {
          const caps = value.split(',').map((c) => c.trim()).filter(Boolean)
          const invalid = caps.filter(
            (c) => !(VALID_PLUGIN_CAPABILITIES as readonly string[]).includes(c)
          )
          if (invalid.length > 0) {
            throw new Error(
              `Invalid capability(ies): ${invalid.join(', ')}. Valid values: ${VALID_PLUGIN_CAPABILITIES.join(', ')}`
            )
          }
          out.pluginCapabilities = caps
          break
        }
        case '--description':
          out.pluginDescription = value
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

    // `setup-encryption-key` as first positional: generate the file-based
    // encryption key for plugin secret storage (Phase 6a v2.2).
    if (
      raw === 'setup-encryption-key' &&
      out.projectName === undefined &&
      !out.setupEncryptionKey &&
      !out.upgrade &&
      !out.copyTheme &&
      !out.createPlugin
    ) {
      out.setupEncryptionKey = true
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

    // `plugin <name>` as first positional triggers the Phase 5 plugin
    // scaffold mode. The next non-flag positional is consumed as the
    // plugin name; anything beyond that falls through to unknown.
    if (
      raw === 'plugin' &&
      out.projectName === undefined &&
      !out.createPlugin &&
      !out.upgrade &&
      !out.copyTheme
    ) {
      out.createPlugin = true
      continue
    }
    if (out.createPlugin && out.pluginName === undefined) {
      out.pluginName = raw
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
  npx create-ampless@latest <project-name> [options]
  npx create-ampless@latest --mount [options]               # in an existing project dir
  npx create-ampless@latest upgrade [options]               # in an existing project dir
  npx create-ampless@latest copy-theme <src> <dst>          # in an existing project dir
  npx create-ampless@latest plugin <name> [options]         # scaffold a plugin (Phase 5)
  npx create-ampless@latest setup-encryption-key [--gitignore]  # generate encryption key file

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

         Example: npx create-ampless@latest copy-theme blog my-blog

plugin <name>
         Scaffold an ampless plugin. Two modes:

  --local                     Default. Writes plugins/<name>/index.ts inside
                              the current ampless site. The site itself is the
                              build / publish unit; the plugin file is just
                              code that sits there. Plugin name is a kebab-case
                              identifier (e.g. "site-verification").

  --standalone                Writes a complete npm package at ./<name>/ ready
                              for 'npm publish'. Plugin name should be the npm
                              package name (e.g. "@scope/ampless-plugin-foo"
                              or "ampless-plugin-foo"); the kebab segment
                              becomes the AmplessPlugin.name.

  --trust-level <value>       'untrusted' (default), 'trusted', or 'privileged'
  --capabilities <list>       Comma-separated. Valid: publicHead, publicBody,
                              metadata, eventHooks, adminSettings,
                              writePublicAsset, schema
                              (default: publicHead,adminSettings)
  --description "<text>"      Optional one-line description

         Examples:
           npx create-ampless@latest plugin site-verification
           npx create-ampless@latest plugin @ishinao/ampless-plugin-foo --standalone

setup-encryption-key
         Generate the AES-256-GCM encryption key for plugin secret storage
         and write it to amplify/secrets/encryption-key.ts (adjacent to
         amplify/backend.ts). No AWS credentials required — this is a
         local file operation only.

         After generating, import the constant in amplify/backend.ts and
         pass it to defineAmplessBackend({ pluginSecretEncryptionKey: ... }).
         Then redeploy (or restart the sandbox) to inject the key into the
         Lambda env vars.

  --gitignore                 Add amplify/secrets/encryption-key.ts to
                              .gitignore. Default: file is committed
                              (safe for private repos). Use this flag only
                              for public repos; distribute the key separately.

         Threat model:
           ✓ DDB Console operator sees ciphertext only
           ⚠ Source repo / deploy artifact access defeats encryption
           ✗ Malicious trusted plugin in the same Lambda can also read
             the key (per-plugin Lambda isolation = roadmap)

         Rotation: re-run with confirm overwrite. Existing ciphertext
         becomes unreadable; re-save each secret via /admin/plugins.

         Example: npx create-ampless@latest setup-encryption-key
         Example: npx create-ampless@latest setup-encryption-key --gitignore
`
