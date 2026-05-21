> 日本語版: [10-cms-updates.ja.md](./10-cms-updates.ja.md)
> 
## 10. CMS Core Updates

### Core Updates

The CMS core is distributed as an npm package.

```bash
npm update ampless
git push  # → Amplify auto-deploys
```

Project structure separates the core from user customizations:

```
├── node_modules/ampless/   ← Managed by npm. Users do not touch this
├── amplify/
│   ├── backend.ts           ← CMS template + user customizations
│   ├── data/resource.ts     ← Schema definitions
│   └── functions/           ← Plugin Lambdas
├── themes/my-theme/         ← Free for users to edit
└── cms.config.ts            ← User configuration file
```

### DB Migrations

```bash
npx ampless migrate
```

Unlike relational databases, DynamoDB has few breaking changes.
Adding GSIs or attributes does not affect existing data.

### CDK Resource Updates

Running `npm update` → `git push` causes the Amplify build pipeline to detect changes in `amplify/backend.ts` and execute a CDK deployment automatically.
Users do not need to be aware of this process.

---
