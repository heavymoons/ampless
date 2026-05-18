/**
 * Canonical `.gitignore` written into every scaffolded project (and
 * into `--mount` targets that don't already have one). Single source of
 * truth shared by `scaffold.ts` and `deploy.ts` so the two paths can't
 * drift.
 *
 * We generate the file from this string instead of shipping
 * `templates/_shared/.gitignore` to dodge npm's historically flaky
 * handling of nested dotfiles in published tarballs.
 */
export const DEFAULT_GITIGNORE = `# Dependencies
node_modules/

# Next.js
.next/
next-env.d.ts

# Amplify
.amplify/
amplify_outputs.json

# TypeScript build artifacts
*.tsbuildinfo

# Env / OS noise
.env
.env.local
.env.*.local
.DS_Store

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Editor
.vscode/
.idea/
`
