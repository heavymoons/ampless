import { describe, it, expect } from 'vitest'
import { parseDeployArgs } from './args.js'

describe('parseDeployArgs', () => {
  it('returns sensible defaults for an empty argv', () => {
    const out = parseDeployArgs([])
    expect(out.deploy).toBe(false)
    expect(out.githubPrivate).toBe(false)
    expect(out.skipConfirm).toBe(false)
    expect(out.projectName).toBeUndefined()
    expect(out.unknown).toEqual([])
  })

  it('captures the first positional as the project name', () => {
    const out = parseDeployArgs(['my-site'])
    expect(out.projectName).toBe('my-site')
  })

  it('parses boolean flags', () => {
    const out = parseDeployArgs(['my-site', '--deploy', '--github-private', '--skip-confirm'])
    expect(out.deploy).toBe(true)
    expect(out.githubPrivate).toBe(true)
    expect(out.skipConfirm).toBe(true)
  })

  it('parses string flags with space form', () => {
    const out = parseDeployArgs([
      'my-site',
      '--github-owner', 'octocat',
      '--aws-region', 'us-east-1',
      '--domain', 'example.com',
      '--subdomain', 'blog',
    ])
    expect(out.githubOwner).toBe('octocat')
    expect(out.awsRegion).toBe('us-east-1')
    expect(out.domain).toBe('example.com')
    expect(out.subdomain).toBe('blog')
  })

  it('parses string flags with --flag=value form', () => {
    const out = parseDeployArgs(['--github-owner=octocat', '--aws-region=eu-west-1'])
    expect(out.githubOwner).toBe('octocat')
    expect(out.awsRegion).toBe('eu-west-1')
  })

  it('shows help on -h / --help', () => {
    expect(parseDeployArgs(['--help']).help).toBe(true)
    expect(parseDeployArgs(['-h']).help).toBe(true)
  })

  it('throws on a string flag missing its value', () => {
    expect(() => parseDeployArgs(['--domain'])).toThrow(/Missing value for --domain/)
  })

  it('collects unknown flags into `unknown` rather than crashing', () => {
    const out = parseDeployArgs(['my-site', '--what-now', 'value'])
    expect(out.projectName).toBe('my-site')
    expect(out.unknown).toContain('--what-now')
  })

  it('treats extra positionals as unknown after the project name', () => {
    const out = parseDeployArgs(['my-site', 'second-thing'])
    expect(out.projectName).toBe('my-site')
    expect(out.unknown).toContain('second-thing')
  })

  it('parses --site-name', () => {
    const out = parseDeployArgs(['--site-name', 'Awesome Blog'])
    expect(out.siteName).toBe('Awesome Blog')
  })

  it('parses --site-name with = form', () => {
    const out = parseDeployArgs(['--site-name=Cool Site'])
    expect(out.siteName).toBe('Cool Site')
  })

  it('parses --themes as a comma-separated list', () => {
    const out = parseDeployArgs(['--themes', 'blog,dads'])
    expect(out.themes).toEqual(['blog', 'dads'])
  })

  it('parses --plugins as a comma-separated list', () => {
    const out = parseDeployArgs(['--plugins', 'seo,rss'])
    expect(out.plugins).toEqual(['seo', 'rss'])
  })

  it('parses a single --themes value', () => {
    const out = parseDeployArgs(['--themes', 'minimal'])
    expect(out.themes).toEqual(['minimal'])
  })

  it('throws on invalid theme name', () => {
    expect(() => parseDeployArgs(['--themes', 'nonexistent'])).toThrow(/Invalid theme/)
  })

  it('throws on invalid plugin name', () => {
    expect(() => parseDeployArgs(['--plugins', 'badplugin'])).toThrow(/Invalid plugin/)
  })

  it('leaves themes/plugins undefined when not passed', () => {
    const out = parseDeployArgs(['my-site'])
    expect(out.themes).toBeUndefined()
    expect(out.plugins).toBeUndefined()
    expect(out.siteName).toBeUndefined()
  })

  it('parses --iam-service-role', () => {
    const out = parseDeployArgs(['--iam-service-role', 'arn:aws:iam::1:role/X'])
    expect(out.iamServiceRole).toBe('arn:aws:iam::1:role/X')
  })

  it('parses --create-iam-role as boolean', () => {
    const out = parseDeployArgs(['my-site', '--create-iam-role'])
    expect(out.createIamRole).toBe(true)
  })

  it('defaults createIamRole to false', () => {
    const out = parseDeployArgs(['my-site'])
    expect(out.createIamRole).toBe(false)
    expect(out.iamServiceRole).toBeUndefined()
  })

  it('parses --mount as boolean (defaults to false)', () => {
    expect(parseDeployArgs([]).mount).toBe(false)
    expect(parseDeployArgs(['--mount']).mount).toBe(true)
  })

  it('combines --mount with deploy-ish flags without losing them', () => {
    const out = parseDeployArgs([
      '--mount',
      '--github-owner', 'ishinao',
      '--aws-profile', 'ishinao_net',
      '--domain', 'ishinao.net',
      '--create-iam-role',
      '--skip-confirm',
    ])
    expect(out.mount).toBe(true)
    expect(out.githubOwner).toBe('ishinao')
    expect(out.awsProfile).toBe('ishinao_net')
    expect(out.domain).toBe('ishinao.net')
    expect(out.createIamRole).toBe(true)
    expect(out.skipConfirm).toBe(true)
  })

  // ---- plugin subcommand tests ----

  it('plugin <name> sets createPlugin and pluginName', () => {
    const out = parseDeployArgs(['plugin', 'foo'])
    expect(out.createPlugin).toBe(true)
    expect(out.pluginName).toBe('foo')
  })

  it('plugin <name> --standalone sets pluginMode to standalone', () => {
    const out = parseDeployArgs(['plugin', 'foo', '--standalone'])
    expect(out.createPlugin).toBe(true)
    expect(out.pluginMode).toBe('standalone')
  })

  it('plugin <name> --local sets pluginMode to local', () => {
    const out = parseDeployArgs(['plugin', 'foo', '--local'])
    expect(out.createPlugin).toBe(true)
    expect(out.pluginMode).toBe('local')
  })

  it('throws when --standalone and --local are combined', () => {
    expect(() => parseDeployArgs(['plugin', 'foo', '--standalone', '--local'])).toThrow(
      /Cannot combine --local and --standalone/,
    )
    expect(() => parseDeployArgs(['plugin', 'foo', '--local', '--standalone'])).toThrow(
      /Cannot combine --local and --standalone/,
    )
  })

  it('--trust-level trusted sets pluginTrustLevel', () => {
    const out = parseDeployArgs(['plugin', 'foo', '--trust-level', 'trusted'])
    expect(out.pluginTrustLevel).toBe('trusted')
  })

  it('throws on invalid --trust-level value', () => {
    expect(() => parseDeployArgs(['plugin', 'foo', '--trust-level', 'invalid'])).toThrow(
      /Invalid --trust-level/,
    )
  })

  it('--capabilities parses comma-separated list', () => {
    const out = parseDeployArgs(['plugin', 'foo', '--capabilities', 'publicHead,adminSettings'])
    expect(out.pluginCapabilities).toEqual(['publicHead', 'adminSettings'])
  })

  it('throws on an invalid capability', () => {
    expect(() =>
      parseDeployArgs(['plugin', 'foo', '--capabilities', 'publicHead,fakeBad']),
    ).toThrow(/Invalid capability/)
  })

  it('--description sets pluginDescription', () => {
    const out = parseDeployArgs(['plugin', 'foo', '--description', 'My plugin'])
    expect(out.pluginDescription).toBe('My plugin')
  })

  it('accepts a scoped npm package name as pluginName in standalone mode', () => {
    const out = parseDeployArgs(['plugin', '@scope/ampless-plugin-bar', '--standalone'])
    expect(out.createPlugin).toBe(true)
    expect(out.pluginName).toBe('@scope/ampless-plugin-bar')
    expect(out.pluginMode).toBe('standalone')
  })

  it('plugin with no name yields createPlugin true and pluginName undefined (prompt fallback)', () => {
    const out = parseDeployArgs(['plugin'])
    expect(out.createPlugin).toBe(true)
    expect(out.pluginName).toBeUndefined()
  })

  it('upgrade subcommand still works after plugin parsing added', () => {
    const out = parseDeployArgs(['upgrade'])
    expect(out.upgrade).toBe(true)
    expect(out.createPlugin).toBe(false)
    expect(out.projectName).toBeUndefined()
  })

  // ---- setup-encryption-key subcommand tests ----

  it('setup-encryption-key sets setupEncryptionKey to true', () => {
    const out = parseDeployArgs(['setup-encryption-key'])
    expect(out.setupEncryptionKey).toBe(true)
    expect(out.projectName).toBeUndefined()
    expect(out.createPlugin).toBe(false)
    expect(out.upgrade).toBe(false)
  })

  it('setupEncryptionKey defaults to false when not specified', () => {
    const out = parseDeployArgs(['my-site'])
    expect(out.setupEncryptionKey).toBe(false)
  })

  it('setup-encryption-key does not conflict with unrelated flags', () => {
    const out = parseDeployArgs(['setup-encryption-key', '--aws-region', 'us-east-1'])
    expect(out.setupEncryptionKey).toBe(true)
    expect(out.awsRegion).toBe('us-east-1')
  })

  it('--gitignore sets gitignore to true', () => {
    const out = parseDeployArgs(['setup-encryption-key', '--gitignore'])
    expect(out.setupEncryptionKey).toBe(true)
    expect(out.gitignore).toBe(true)
  })

  it('gitignore defaults to false when not specified', () => {
    const out = parseDeployArgs(['setup-encryption-key'])
    expect(out.gitignore).toBe(false)
  })
})
