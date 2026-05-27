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
  ampless/           — CMS core library, hooks, types (npm: ampless)
  admin/             — Admin app components, providers, hooks (npm: @ampless/admin)
  runtime/           — Next.js runtime: middleware, dispatchers, public routes (npm: @ampless/runtime)
  backend/           — Amplify Gen 2 backend wiring + AppSync schema (npm: @ampless/backend)
  mcp-server/        — MCP tool registry, stdio + HTTP transports (npm: @ampless/mcp-server)
  create-ampless/    — CLI scaffolding / upgrade tool (npm: create-ampless)
  plugin-seo/        — SEO meta plugin (npm: @ampless/plugin-seo)
  plugin-rss/        — RSS feed plugin (npm: @ampless/plugin-rss)
  plugin-og-image/   — OG image generator plugin (npm: @ampless/plugin-og-image)
  plugin-webhook/    — Outbound webhook plugin (npm: @ampless/plugin-webhook)
templates/
  _shared/           — Theme-agnostic app/ tree + Amplify backend (copied by create-ampless)
  blog/              — Blog theme overlay
  corporate/         — Corporate theme overlay
  dads/              — DADS (Digital Agency design system) theme overlay
  docs/              — Docs/handbook theme overlay
  landing/           — Single-page landing theme overlay
  minimal/           — Minimal headless-friendly theme overlay
```

## Tech Stack

- **Runtime:** Node.js >= 22.13 (required by pnpm 11)
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
- Posts carry a `format` field (`tiptap` / `markdown` / `html` / `static`); the body shape matches the declared format. `tiptap` stores tiptap document JSON; `markdown` / `html` store the source string; `static` stores a manifest pointing at a pre-uploaded bundle in S3.
- Plugin trust levels: untrusted / trusted / privileged (see ARCHITECTURE.md §4)

## Changeset Policy

- **Every PR that touches a published package needs a changeset** in `.changeset/`, including doc-only edits to that package's README (the README ships in the npm tarball, so a republish is needed for users to see the update).
- Use `pnpm changeset` to scaffold one, or hand-write a file like `.changeset/<slug>.md` with the frontmatter `"<package>": patch | minor | major`.
- Bump rule of thumb: `patch` for docs / bug fixes, `minor` for additive features, `major` for breaking API changes (pre-1.0 we still bump `minor` for breakage but call it out in the body).
- Multi-package PRs list every affected package in the same changeset frontmatter.
- Pure repo-level changes (root `README.md`, CI config, `CLAUDE.md`, top-level `docs/`) don't need a changeset — they don't ship in any tarball.
- The Version Packages bot opens the release PR from accumulated changesets; merging it triggers the npm publish workflow. Forgetting a changeset means the fix never reaches users.
- **New packages need a `packages/<pkg>/CHANGELOG.md`** at creation time (even just `# @ampless/<pkg>`). `changesets/action` reads it when assembling the Version Packages PR body and crashes with `ENOENT` if missing.

### Don't run `changeset version` locally during feature-PR work

Only CI runs `pnpm changeset version` / `pnpm version-packages` / `pnpm release` / `pnpm changeset pre exit|enter`. Running them locally during a feature PR rewrites `.changeset/pre.json`'s `changesets` array, and if you then commit that pre.json with your `.md` still on disk, the merged state on `main` looks "already consumed" to changesets/action — **no Version Packages PR opens** for your changeset and your bump is silently dropped. We've hit this twice (#135, #139) before locking down the rule.

Safe local commands while iterating:

- `pnpm changeset` — interactive scaffold for a new `.md`
- Hand-edit `.changeset/<slug>.md`
- `pnpm changeset status` — read-only, shows what bumps *would* happen

If a stale `.changeset/pre.json` slips through and the symptom shows up (Release workflow says `No changesets found` and no VP PR appears), the fix is a one-line PR that removes the stale entry from `pre.json` without touching the `.md`. Full operational details and recovery steps live in [docs/release-workflow.md](./docs/release-workflow.md).

## Documentation Language Policy

- **Primary language for `*.md` is English.** New documentation should be authored in English at `name.md`.
- **Japanese translation lives at `name.ja.md`** alongside the English file (e.g. `README.md` ↔ `README.ja.md`, `docs/architecture/01-overview.md` ↔ `docs/architecture/01-overview.ja.md`).
- Each file should link to the other language at the top, e.g.:
  - English: `> 日本語版: [README.ja.md](./README.ja.md)`
  - Japanese: `> English: [README.md](./README.md)`
- When updating documentation, update **both** language versions in the same change. If only one side is updated, note in the PR that the other side is pending.
- Auto-generated files (`CHANGELOG.md`, `.changeset/*.md`) are exempt — they stay single-language (English).
- Package/template `README.md` files follow the same rule when translations exist; otherwise English-only is acceptable.

## Local Working Notes

- Temporary development notes, review summaries, scratch design docs, and any other local-only handoff files belong under `docs/tmp/`. This directory is gitignored, so contents stay on the contributor's machine and never reach the repo.
- Use it for personal scratch space or for handing off context to an agent / future-you when the note isn't ready (or isn't intended) to be shared. Promote a note to a regular `docs/` path once it's ready for the repo, and follow the language policy above when you do.

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

Private repo in closed alpha development. Packages publish to npm under the `alpha` dist-tag from the `main` branch via changesets. The bar for the first public release is **v1.0 RC**: first-party dogfood sites running on ampless, no marketplace required.
