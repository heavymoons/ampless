import { describe, it, expect } from 'vitest'
import {
  extractRegistrableDomain,
  splitDomain,
  resolveGithubToken,
  AMPLIFY_BUILD_SPEC,
} from './deploy.js'

describe('extractRegistrableDomain', () => {
  it('returns the registrable root for common gTLDs', () => {
    expect(extractRegistrableDomain('example.com')).toBe('example.com')
    expect(extractRegistrableDomain('blog.example.com')).toBe('example.com')
    expect(extractRegistrableDomain('a.b.c.example.io')).toBe('example.io')
  })

  it('handles multi-part ccTLDs', () => {
    expect(extractRegistrableDomain('example.co.uk')).toBe('example.co.uk')
    expect(extractRegistrableDomain('www.example.co.uk')).toBe('example.co.uk')
    expect(extractRegistrableDomain('blog.example.co.jp')).toBe('example.co.jp')
    expect(extractRegistrableDomain('example.com.au')).toBe('example.com.au')
  })

  it('handles a bare domain with no subdomain', () => {
    expect(extractRegistrableDomain('foo.io')).toBe('foo.io')
  })

  it('strips a trailing dot', () => {
    expect(extractRegistrableDomain('example.com.')).toBe('example.com')
  })
})

describe('splitDomain', () => {
  it('returns the apex when no subdomain present', () => {
    expect(splitDomain('example.com', undefined)).toEqual({
      registrable: 'example.com',
      subdomain: '',
    })
  })

  it('splits an embedded subdomain', () => {
    expect(splitDomain('blog.example.com', undefined)).toEqual({
      registrable: 'example.com',
      subdomain: 'blog',
    })
  })

  it('respects an explicit --subdomain', () => {
    expect(splitDomain('example.com', 'docs')).toEqual({
      registrable: 'example.com',
      subdomain: 'docs',
    })
  })

  it('handles a ccTLD registrable correctly', () => {
    expect(splitDomain('blog.example.co.uk', undefined)).toEqual({
      registrable: 'example.co.uk',
      subdomain: 'blog',
    })
  })
})

describe('resolveGithubToken', () => {
  it('prefers an explicit token', async () => {
    const t = await resolveGithubToken('explicit-token', {})
    expect(t).toBe('explicit-token')
  })

  it('falls back to GITHUB_TOKEN env', async () => {
    const t = await resolveGithubToken(undefined, { GITHUB_TOKEN: 'env-token' })
    expect(t).toBe('env-token')
  })

  it('trims whitespace from explicit and env tokens', async () => {
    expect(await resolveGithubToken('  spaced  ', {})).toBe('spaced')
    expect(await resolveGithubToken(undefined, { GITHUB_TOKEN: '  spaced  ' })).toBe('spaced')
  })

  // Note: the `gh auth token` fallback is exercised in the live environment;
  // unit-testing it would require either mocking execa (out of scope here) or
  // depending on the host's gh state. We trust the env fallback test +
  // manual verification for that branch.
})

describe('AMPLIFY_BUILD_SPEC', () => {
  it('matches the snapshot (regenerate intentionally if changing)', () => {
    expect(AMPLIFY_BUILD_SPEC).toMatchInlineSnapshot(`
      "version: 1
      frontend:
        phases:
          preBuild:
            commands:
              - npm install
          build:
            commands:
              - npx ampx pipeline-deploy --branch \$AWS_BRANCH --app-id \$AWS_APP_ID
              - npm run build
        artifacts:
          baseDirectory: .next
          files:
            - '**/*'
        cache:
          paths:
            - node_modules/**/*
            - .next/cache/**/*
      "
    `)
  })
})
