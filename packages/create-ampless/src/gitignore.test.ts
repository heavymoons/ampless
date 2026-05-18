import { describe, it, expect } from 'vitest'
import { DEFAULT_GITIGNORE } from './gitignore.js'

describe('DEFAULT_GITIGNORE', () => {
  it('ignores the high-risk paths that would break a deploy or leak secrets', () => {
    // Each of these is load-bearing: missing any entry has bitten real
    // projects (committed node_modules, amplify_outputs.json with live
    // identity pool ids, .env files with secrets, .next caches).
    const required = [
      'node_modules/',
      '.next/',
      'next-env.d.ts',
      '.amplify/',
      'amplify_outputs.json',
      '*.tsbuildinfo',
      '.env',
      '.env.local',
      '.env.*.local',
      '.DS_Store',
    ]
    for (const entry of required) {
      expect(DEFAULT_GITIGNORE).toContain(entry)
    }
  })

  it('ends with a trailing newline (POSIX text-file convention)', () => {
    expect(DEFAULT_GITIGNORE.endsWith('\n')).toBe(true)
  })
})
