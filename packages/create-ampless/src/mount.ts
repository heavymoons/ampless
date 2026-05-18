import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * In `--mount` mode the CLI publishes the CURRENT working directory onto a
 * fresh GitHub repo + Amplify Hosting app. Validate that the cwd looks like
 * an ampless project before we mutate any cloud state — otherwise the user
 * just runs `--mount` in a random directory and ends up with a broken repo.
 *
 * Returns a human-readable error string when the directory is invalid, or
 * `null` when it looks like a valid ampless project.
 */
export function validateMountableProject(destDir: string): string | null {
  const required = ['package.json', 'cms.config.ts']
  for (const f of required) {
    if (!existsSync(resolve(destDir, f))) {
      return `Not an ampless project (missing ${f} in ${destDir})`
    }
  }
  // Amplify backend may live as either backend.ts (older) or as a folder
  // with at least data/resource.ts. Accept either.
  const amplifyFiles = ['amplify/backend.ts', 'amplify/data/resource.ts']
  if (!amplifyFiles.some((f) => existsSync(resolve(destDir, f)))) {
    return `Not an ampless project (missing amplify/ in ${destDir})`
  }
  return null
}

/**
 * Default `.gitignore` we drop into a mount target if one isn't already
 * present. Mirrors what `templates/_shared/.gitignore` contains so older
 * scaffolds (and hand-rolled projects) don't accidentally commit
 * `amplify_outputs.json` or `node_modules`.
 */
export const MOUNT_DEFAULT_GITIGNORE = `# Dependencies
node_modules/

# Next.js
.next/
.amplify/

# Amplify outputs (regenerated on every deploy / sandbox)
amplify_outputs.json

# Env / OS noise
.env
.env.local
.env.*.local
.DS_Store

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
`

/**
 * Check whether an existing `origin` URL points at the repo we are about
 * to mount onto. Accept the canonical https URL, the .git suffix variant,
 * and the ssh form — `gh repo create` uses ssh by default.
 */
export function originPointsAt(origin: string, owner: string, name: string): boolean {
  const candidates = [
    `https://github.com/${owner}/${name}`,
    `https://github.com/${owner}/${name}.git`,
    `git@github.com:${owner}/${name}`,
    `git@github.com:${owner}/${name}.git`,
    `ssh://git@github.com/${owner}/${name}`,
    `ssh://git@github.com/${owner}/${name}.git`,
  ]
  return candidates.includes(origin)
}
