> 日本語版: [10-cms-updates.ja.md](./10-cms-updates.ja.md)
> 
## 10. CMS Core Updates

### Distribution Shape

ampless ships as a set of npm packages. A scaffolded project depends on the ones it actually uses:

| Package | Role |
|---|---|
| `ampless` | Types, plugin / theme / config contracts, helpers |
| `@ampless/admin` | Admin app components, providers, server actions |
| `@ampless/runtime` | Public-side runtime: middleware, dispatchers, route handlers |
| `@ampless/backend` | Amplify Gen 2 backend wiring + AppSync schema |
| `@ampless/plugin-*` | First-party plugins (seo / rss / og-image / webhook) |
| `create-ampless` | Scaffolding + upgrade CLI |

The scaffolded project is a thin shell: `cms.config.ts`, theme overlay, route shells that compose dispatchers from `@ampless/runtime`, and an `amplify/` tree that wires `@ampless/backend`. Updating ampless means bumping the package versions — the shell rarely needs to change.

```
my-site/
├── package.json                 ← project depends on ampless + @ampless/*
├── cms.config.ts                ← user config (site, plugins, media, cache)
├── themes-registry.ts           ← user-managed theme list
├── amplify/
│   ├── backend.ts               ← thin: calls defineAmplessBackend(...)
│   ├── data/resource.ts         ← thin: spreads amplessSchemaModels(a)
│   ├── auth/resource.ts         ← thin: returns amplessAuthConfig(...)
│   └── functions/<name>/handler.ts  ← thin: re-exports from @ampless/backend
├── app/
│   ├── (admin)/admin/…          ← admin routes (regenerated on upgrade)
│   ├── [slug]/page.tsx          ← thin: createThemePostDispatcher(ampless)
│   ├── raw/<slug>/route.ts      ← thin: createRawRouteHandler(ampless)
│   └── static/[slug]/[[...path]]/route.ts  ← thin: createStaticRouteHandler(ampless)
└── themes/<your-theme>/…        ← user-owned theme code
```

### Updating ampless

Two operations cover the lifecycle:

```bash
# 1. Update the npm packages
pnpm update ampless @ampless/admin @ampless/runtime @ampless/backend \
            @ampless/plugin-seo @ampless/plugin-rss

# 2. Refresh the template-owned files (route shells, admin pages, etc.)
npx create-ampless@beta --upgrade
```

`--upgrade` syncs the **ampless-managed paths** in the project (admin routes, internal route shells, API proxy routes) to whatever the current template ships. The list of managed paths is fixed in [`packages/create-ampless/src/upgrade.ts`](../../packages/create-ampless/src/upgrade.ts) (`AMPLESS_MANAGED_APP_PATHS`). User-owned files outside those paths (`themes/`, `app/page.tsx`, `cms.config.ts`, etc.) are never touched.

Then `git push` triggers the Amplify Hosting build: type-check, bundle Lambdas, deploy the CDK changes. The Version Packages bot (changesets) handles the release notes on the ampless side; user projects see whatever made it into the bumped package versions.

### "Migrations"

There is no `ampless migrate` command. DynamoDB is the source of truth and the schema changes ampless makes are additive:

- **New field on a model** — Amplify Gen 2 widens the AppSync type; existing rows return the new field as `null` until written.
- **New index** — provisioned by CDK on the next deploy.
- **New model** — provisioned by CDK on the next deploy; empty until written to.
- **Removed field** — disappears from the AppSync schema; the DynamoDB attribute stays in the row but no longer surfaces. Drift is not actively cleaned up.

For destructive shape changes (renaming a model, splitting one model into two) the migration is a Lambda one-shot per deploy, not a CLI command. None of the current models has needed one.

### CDK Resources

Project changes that touch `amplify/backend.ts` or any `amplify/*/resource.ts` flow through the normal Amplify Hosting build — `git push` runs CDK synth and deploys. Users don't drive this manually; the CDK changes ride along with the same deployment that ships the application bundle.

---
