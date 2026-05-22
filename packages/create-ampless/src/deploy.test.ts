import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  extractRegistrableDomain,
  splitDomain,
  resolveGithubToken,
  rewriteCmsConfigForDomain,
  AMPLIFY_BUILD_SPEC,
} from './deploy.js'

async function makeProject(content: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(resolve(tmpdir(), 'rewrite-cms-config-'))
  await writeFile(resolve(dir, 'cms.config.ts'), content, 'utf-8')
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

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

describe('rewriteCmsConfigForDomain', () => {
  // Matches templates/_shared/cms.config.ts (only the bits we care about).
  const scaffold = `import { defineConfig } from 'ampless'

export default defineConfig({
  site: {
    name: '{{siteName}}',
    url: 'http://localhost:3000',
  },
  dateFormat: 'iso',
})
`

  it('rewrites the localhost url on a scaffolded config', async () => {
    const { dir, cleanup } = await makeProject(scaffold)
    try {
      const result = await rewriteCmsConfigForDomain(dir, 'ampless.example.com')
      expect(result).toEqual({ urlRewritten: true })

      const out = await readFile(resolve(dir, 'cms.config.ts'), 'utf-8')
      expect(out).toContain(`url: 'https://ampless.example.com'`)
      expect(out).not.toContain(`'http://localhost:3000'`)
    } finally {
      await cleanup()
    }
  })

  it('preserves a user-customized url (mount mode)', async () => {
    const custom = scaffold.replace(
      `url: 'http://localhost:3000'`,
      `url: 'https://my-staging.example.com'`
    )
    const { dir, cleanup } = await makeProject(custom)
    try {
      const result = await rewriteCmsConfigForDomain(dir, 'production.example.com')
      expect(result.urlRewritten).toBe(false)

      const out = await readFile(resolve(dir, 'cms.config.ts'), 'utf-8')
      expect(out).toContain(`url: 'https://my-staging.example.com'`)
    } finally {
      await cleanup()
    }
  })

  it('returns no mutations when cms.config.ts is missing', async () => {
    const { dir, cleanup } = await makeProject(scaffold)
    try {
      await rm(resolve(dir, 'cms.config.ts'))
      const result = await rewriteCmsConfigForDomain(dir, 'example.com')
      expect(result).toEqual({ urlRewritten: false })
    } finally {
      await cleanup()
    }
  })

  it('works against the actual templates/_shared/cms.config.ts', async () => {
    const realTemplate = await readFile(
      resolve(__dirname, '..', '..', '..', 'templates', '_shared', 'cms.config.ts'),
      'utf-8'
    )
    const { dir, cleanup } = await makeProject(realTemplate)
    try {
      const result = await rewriteCmsConfigForDomain(dir, 'ampless.heavymoons.net')
      expect(result).toEqual({ urlRewritten: true })

      const out = await readFile(resolve(dir, 'cms.config.ts'), 'utf-8')
      expect(out).toContain(`url: 'https://ampless.heavymoons.net'`)
      expect(out).not.toContain(`'http://localhost:3000'`)
    } finally {
      await cleanup()
    }
  })

  it('produces idempotent results (running twice = same file)', async () => {
    const { dir, cleanup } = await makeProject(scaffold)
    try {
      await rewriteCmsConfigForDomain(dir, 'example.com')
      const after1 = await readFile(resolve(dir, 'cms.config.ts'), 'utf-8')
      const result2 = await rewriteCmsConfigForDomain(dir, 'example.com')
      const after2 = await readFile(resolve(dir, 'cms.config.ts'), 'utf-8')
      expect(after1).toBe(after2)
      expect(result2).toEqual({ urlRewritten: false })
    } finally {
      await cleanup()
    }
  })
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
