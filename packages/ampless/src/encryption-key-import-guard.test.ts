// Guard test: encryption-key.ts must NOT be imported from client code paths.
//
// amplify/secrets/encryption-key.ts holds the AES-256-GCM master key.
// It should only ever be imported by amplify/backend.ts (CDK deploy path),
// never from any client-side or admin-side module that could ship to the
// browser bundle or be included in a Next.js server component that runs
// outside of the CDK context.
//
// If this test fails, a file in a client code path has gained an import
// of the key file. Remove it immediately.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Directories to scan for client code (relative to monorepo root)
const CLIENT_CODE_DIRS = [
  'packages/admin/src',
  'templates/_shared/app',
  'templates/_shared/components',
]

// Files allowed to import the key (CDK deploy path only)
const ALLOWED_IMPORTERS = [
  'amplify/backend.ts',
  'amplify/backend.custom.ts',
]

// Pattern to detect imports of the encryption key file
const KEY_IMPORT_PATTERN = /from\s+['"].*amplify\/secrets\/encryption-key/

/**
 * Recursively collect all .ts/.tsx files under a directory.
 */
function collectFiles(dir: string): string[] {
  const result: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    // Directory doesn't exist in this checkout — skip it
    return result
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    let stat
    try {
      stat = statSync(fullPath)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      result.push(...collectFiles(fullPath))
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      result.push(fullPath)
    }
  }
  return result
}

describe('encryption-key import guard', () => {
  it('encryption-key.ts is not imported from client code paths', () => {
    // Find the monorepo root (4 levels up from packages/ampless/src/)
    const monorepoRoot = join(import.meta.dirname ?? __dirname, '../../../..')

    const violations: string[] = []

    for (const clientDir of CLIENT_CODE_DIRS) {
      const absDir = join(monorepoRoot, clientDir)
      const files = collectFiles(absDir)
      for (const file of files) {
        let content: string
        try {
          content = readFileSync(file, 'utf-8')
        } catch {
          continue
        }
        if (KEY_IMPORT_PATTERN.test(content)) {
          // Check if this file is in the allowed-importers list
          const isAllowed = ALLOWED_IMPORTERS.some((allowed) => file.includes(allowed))
          if (!isAllowed) {
            violations.push(file)
          }
        }
      }
    }

    if (violations.length > 0) {
      const msg =
        'Found import of amplify/secrets/encryption-key from client code:\n' +
        violations.map((f) => `  ${f}`).join('\n') +
        '\n\nThe encryption key must ONLY be imported from amplify/backend.ts (CDK deploy path).'
      expect.fail(msg)
    }

    expect(violations).toHaveLength(0)
  })
})
