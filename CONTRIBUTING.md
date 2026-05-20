> 日本語版: [CONTRIBUTING.ja.md](./CONTRIBUTING.ja.md)
> 

# Contributing to ampless

Thanks for your interest in contributing!

## Development Setup

```bash
# Clone the repo
git clone https://github.com/YOUR_ORG/ampless.git
cd ampless

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run in development mode
pnpm dev
```

## Project Structure

This is a monorepo managed with pnpm workspaces and Turborepo.

- `packages/ampless` — CMS core library
- `packages/create-ampless` — CLI scaffolding tool (`npx create-ampless@latest`)
- `packages/plugin-seo` — Core SEO plugin
- `templates/blog` — Blog starter template

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Run `pnpm changeset` to describe your changes for the changelog
3. Make sure `pnpm build` and `pnpm test` pass
4. Open a pull request

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
