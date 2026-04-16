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
