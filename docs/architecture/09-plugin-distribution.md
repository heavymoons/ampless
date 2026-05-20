> 日本語版: [09-plugin-distribution.ja.md](./09-plugin-distribution.ja.md)
> 
## 9. Plugin Distribution and Installation

### Method A: Build-time (Core Plugins)

Distributed as npm packages. Bundled at build time.

```bash
npm install @ampless/plugin-seo
```

```typescript
// amplify/plugins.ts
import { defineCmsPlugins } from 'ampless';
export const plugins = defineCmsPlugins([
  '@ampless/plugin-seo',
  '@ampless/plugin-contact-form',
]);
```

git push → Amplify auto-build and deploy.

Advantages: npm version management, lockfile, and security auditing work as-is.
Disadvantages: Every addition triggers a deployment. Non-developers cannot operate independently.

### Method B: Runtime (Third-party Plugins)

Installed from the admin UI. Plugin code is stored in S3 and loaded dynamically at Lambda execution time.

```
Admin UI "Add Plugin"
  → Upload bundled JS to S3
  → Register manifest in DynamoDB
  → At Lambda execution: fetch code from S3
  → Execute via new Function() (in the appropriate Lambda for the trust_level)
```

Caching strategy:
1. In-memory cache within Lambda (retained across warm starts)
2. /tmp file cache (fast even on cold starts)
3. Fetch from S3 (only on a completely fresh first execution)

Plugin authors distribute as a single bundled JS file using esbuild or similar.

### v1 Policy
- Core plugins use Method A (npm)
- Third-party plugins use Method B (S3 + runtime loading)
- Hybrid operation combining both methods

---
