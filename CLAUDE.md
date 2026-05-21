> 日本語版: [CLAUDE.ja.md](./CLAUDE.ja.md)
> 
# ampless — Claude Code Project Guide

## Project Overview

ampless is a serverless CMS for AWS Amplify — the "EmDash for AWS" position.
See ARCHITECTURE.md for full design details.

## Repository Structure

Monorepo managed with pnpm workspaces + Turborepo + changesets.

```
packages/
  ampless/           — CMS core library (npm: ampless)
  create-ampless/    — CLI scaffolding tool (npm: create-ampless)
  plugin-seo/        — SEO plugin (npm: @ampless/plugin-seo)
templates/
  blog/              — Blog starter template (copied by create-ampless CLI)
```

## Tech Stack

- **Runtime:** Node.js >= 20
- **Language:** TypeScript (ESM only)
- **Package manager:** pnpm (workspaces)
- **Build:** tsup (per-package)
- **Test:** vitest
- **Lint:** ESLint + Prettier
- **Versioning:** changesets (independent per package)
- **CI:** GitHub Actions

## Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages (via Turborepo)
pnpm test             # Run all tests
pnpm lint             # Lint all packages
pnpm changeset        # Create a changeset for versioning
```

## Conventions

- All packages output ESM (`"type": "module"`)
- Shared TypeScript config in `tsconfig.base.json`, each package extends it
- Each package has its own `tsup.config.ts` for build configuration
- Use `@clack/prompts` for CLI interactive prompts (not inquirer)
- Content is stored as Portable Text (structured JSON)
- Plugin trust levels: untrusted / trusted / privileged (see ARCHITECTURE.md §4)

## Changeset Policy

- **Every PR that touches a published package needs a changeset** in `.changeset/`, including doc-only edits to that package's README (the README ships in the npm tarball, so a republish is needed for users to see the update).
- Use `pnpm changeset` to scaffold one, or hand-write a file like `.changeset/<slug>.md` with the frontmatter `"<package>": patch | minor | major`.
- Bump rule of thumb: `patch` for docs / bug fixes, `minor` for additive features, `major` for breaking API changes (pre-1.0 we still bump `minor` for breakage but call it out in the body).
- Multi-package PRs list every affected package in the same changeset frontmatter.
- Pure repo-level changes (root `README.md`, CI config, `CLAUDE.md`, top-level `docs/`) don't need a changeset — they don't ship in any tarball.
- The Version Packages bot opens the release PR from accumulated changesets; merging it triggers the npm publish workflow. Forgetting a changeset means the fix never reaches users.

## Documentation Language Policy

- **Primary language for `*.md` is English.** New documentation should be authored in English at `name.md`.
- **Japanese translation lives at `name.ja.md`** alongside the English file (e.g. `README.md` ↔ `README.ja.md`, `docs/architecture/01-overview.md` ↔ `docs/architecture/01-overview.ja.md`).
- Each file should link to the other language at the top, e.g.:
  - English: `> 日本語版: [README.ja.md](./README.ja.md)`
  - Japanese: `> English: [README.md](./README.md)`
- When updating documentation, update **both** language versions in the same change. If only one side is updated, note in the PR that the other side is pending.
- Auto-generated files (`CHANGELOG.md`, `.changeset/*.md`) are exempt — they stay single-language (English).
- Package/template `README.md` files follow the same rule when translations exist; otherwise English-only is acceptable.

## AWS / Amplify Specifics

- Amplify Gen 2 (CDK-based, TypeScript)
- DynamoDB for content storage (not RDS)
- S3 for media files
- Cognito for authentication
- Lambda for plugin execution (IAM-based sandboxing, not V8 isolate)

## npm Packages

- Scope: `@ampless` (npm org secured)
- Core package: `ampless`
- CLI: `create-ampless` (invoked as `npx create-ampless@latest`)
- Plugins: `@ampless/plugin-*`

## Status

Early development (private repo). Targeting v0.1.0 for initial public release.
