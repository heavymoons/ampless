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
})
