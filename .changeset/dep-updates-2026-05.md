---
'@ampless/admin': patch
'ampless': patch
'@ampless/backend': patch
'@ampless/mcp-server': patch
'@ampless/plugin-og-image': patch
'@ampless/runtime': patch
'create-ampless': patch
---

Bump direct dependencies to their latest semver-minor / patch versions.
No source changes — `pnpm install` + `pnpm-lock.yaml` regeneration only,
verified clean on `pnpm lint` / `pnpm test` / `pnpm build`.

Notable bumps (all backward-compatible):

- AWS SDK v3 clients: `^3.717.0` → `^3.1053.0` across backend / mcp-server.
- `@aws-amplify/backend`: `^1.13.0` → `^1.22.0`; `aws-cdk-lib`: `^2.174.0` → `^2.257.0`.
- `@modelcontextprotocol/sdk`: `^1.0.0` → `^1.29.0`.
- Tailwind CSS: `^4.0.0` → `^4.3.0` (templates).
- Radix UI primitives, React 19.x, `@aws-amplify/adapter-nextjs`, tiptap 3.23.x — all minor / patch.

Also touches the `templates/_shared` README + AGENTS, replacing the
stale "Next.js 15" claim with "Next.js 16" so the user-facing docs
match the actual pinned version (`next@^16.2.6`).

Out of scope for this update (deferred to follow-ups): `pnpm` 9 → 11
(packageManager), `marked` 14 → 18 (runtime markdown rendering),
`@types/node` 22 → 25 (intentionally pinned at 22 — project requires
Node 20+ at runtime).

Known leftover advisories (`pnpm audit`): 23 vulnerabilities surface
in transitive deps pulled by upstream packages (handlebars / lodash /
hono / fast-uri / etc. via Amplify backend, AWS SDK, MCP SDK). None
are reachable through ampless's own surface; resolution is upstream.
