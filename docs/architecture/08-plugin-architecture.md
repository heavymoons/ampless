> 日本語版: [08-plugin-architecture.ja.md](./08-plugin-architecture.ja.md)
> 
## 8. Plugin Architecture

### Design Philosophy
While EmDash sandboxes plugins using V8 isolates,
this CMS **leverages AWS IAM as the sandbox**.
Lambda function-level isolation combined with IAM policy-based permission control
eliminates the need for runtime sandboxes such as isolated-vm.

### Lambda Configuration by trust_level

A dedicated Lambda function is provisioned for each of the three trust levels.

#### untrusted (untrusted plugins)

- **IAM permissions**: None (zero)
- **Can do**: Pure JavaScript execution only. Input text transformation and processing
- **Cannot do**: Access any AWS resources
- **Use cases**: Markdown decoration, character counting, OGP text generation
- **Memory**: 128–256 MB
- **Defense**: Hide global objects (`process`, `require`, etc.) using `new Function()`

```javascript
function executePlugin(code, cmsApi) {
  const safeScope = {
    process: undefined,
    require: undefined,
    global: undefined,
    globalThis: undefined,
    Buffer: undefined,
    cms: cmsApi
  };
  const keys = Object.keys(safeScope);
  const values = Object.values(safeScope);
  const fn = new Function(...keys, `"use strict";\n${code}`);
  return fn(...values);
}
```

#### trusted (reasonably trusted plugins)

- **IAM permissions**: Read content table, read S3 public, read own PK in plugin-data
- **Can do**: Access public content, read media files, read own plugin data
- **Cannot do**: Write, access S3 private, integrate with external services
- **Use cases**: SEO meta tag generation, related posts display, sitemap generation, RSS
- **Memory**: 256–512 MB

#### privileged (highly trusted plugins)

- **IAM permissions**: Dynamically generated policy based on capability declarations
- **Can do**: Send email, save form data, call external APIs, etc.
- **Cannot do**: Access resources beyond declared capabilities
- **Use cases**: Contact forms, email notifications, Analytics integration, payments
- **Memory**: 512 MB

```json
{
  "name": "contact-form",
  "version": "1.0.0",
  "trust_level": "privileged",
  "capabilities": ["ses:SendEmail", "plugin-data:write", "s3:private:write"]
}
```

IAM policies are dynamically assembled from capabilities:

```typescript
function buildPluginPolicy(pluginName: string, capabilities: string[]) {
  const statements = [];

  for (const cap of capabilities) {
    switch (cap) {
      case 'ses:SendEmail':
        statements.push({
          actions: ['ses:SendEmail'],
          resources: ['arn:aws:ses:*:*:identity/noreply@example.com']
        });
        break;
      case 'plugin-data:write':
        statements.push({
          actions: ['dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:DeleteItem'],
          resources: ['arn:aws:dynamodb:*:*:table/ampless-plugin-data'],
          condition: { 'dynamodb:LeadingKeys': [`plugin#${pluginName}`] }
        });
        break;
      case 's3:private:write':
        statements.push({
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [`arn:aws:s3:::ampless-bucket/private/plugins/${pluginName}/*`]
        });
        break;
    }
  }

  return statements;
}
```

### API Spec Versioning

The plugin and theme specifications (`definePlugin` / `defineTheme` API) are versioned.
The version is incremented when the ampless core makes breaking changes.

```typescript
// Spec versions currently supported by the ampless core
const SUPPORTED_PLUGIN_API_VERSIONS = [1]
const SUPPORTED_THEME_API_VERSIONS = [1]
```

Plugins and themes declare their `apiVersion`:

```typescript
// Plugin
export default definePlugin({
  apiVersion: 1,
  name: 'seo-plugin',
  trust_level: 'trusted',
  ...
})

// Theme
export default defineTheme({
  apiVersion: 1,
  name: 'Blog',
  ...
})
```

The core branches its loading logic based on `apiVersion`.
Older specs are supported for a period; unsupported versions produce a clear error.

```typescript
function loadPlugin(manifest) {
  if (!SUPPORTED_PLUGIN_API_VERSIONS.includes(manifest.apiVersion)) {
    throw new Error(
      `Plugin "${manifest.name}" requires apiVersion ${manifest.apiVersion}, ` +
      `but this version of ampless supports: ${SUPPORTED_PLUGIN_API_VERSIONS.join(', ')}`
    )
  }
  // Load according to apiVersion
}
```

### Plugin Manifest

```json
{
  "apiVersion": 1,
  "name": "seo-plugin",
  "trust_level": "trusted",
  "description": "Auto-generate meta tags and OGP",
  "entry": "bundle.js"
}
```

### Lambda Memory Configuration Policy
- 128 MB is only AWS-recommended for minimal processing and provides extremely limited CPU
- 128 MB and 512 MB often have the same cost (shorter execution time reduces GB-seconds proportionally)
- Baseline: untrusted: 256 MB / trusted: 256–512 MB / privileged: 512 MB
- Cold start is approximately 200–400 ms for Node.js. Not an issue for CMS plugin workloads
  - High traffic → Lambda stays warm (cold start rate under 1%)
  - Low traffic → a few hundred ms of latency is acceptable

### On Runtime Sandboxes (not adopted for v1)
- isolated-vm requires the `--no-node-snapshot` flag on Node.js 20+
  → Cannot control startup flags on Lambda managed runtime; requires container image Lambda
  → Worse cold starts, maintenance mode, native binary build complexity
- IAM-based isolation is judged sufficient for v1
- quickjs-emscripten etc. will be considered in v2+ when a marketplace is launched

### Plugin Data Storage

A mechanism is provided for plugins to store their own data.
Rather than creating a new DynamoDB table per plugin,
a shared table + S3 path separation is used.

#### S3 Bucket Layout

```
s3://ampless-bucket/
  public/                         ← Publicly accessible (via bucket policy)
    media/                        ← Media files (images, video)
    plugins/{pluginName}/         ← Plugin public files
  private/                        ← Accessible only from Lambda
    plugins/{pluginName}/         ← Plugin private data
```

| Path | Access | Example use cases |
|------|--------|------------------|
| `public/media/` | Via next/image (default) or direct S3 URL | Uploaded images (next/image), video/PDF (S3 direct) |
| `public/plugins/{name}/` | Direct S3 URL | OGP images, sitemap, RSS, CSS/JS widgets |
| `private/plugins/{name}/` | Lambda only | Form submissions, API keys, config files |

Everything under `public/` is made public via bucket policy.
The media delivery method is configurable via `media.delivery` in `cms.config.ts` (see §3 Media Management for details).
Large files such as video and PDF are always delivered via direct S3 URL to avoid the Lambda 6 MB response limit.

```json
{
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::ampless-bucket/public/*"
}
```

If CloudFront is added in front of S3 in the future, this path structure requires no changes.

Note: Amplify Storage uses pre-signed (temporary) URLs by default, but CMS media delivery requires permanent URLs, so the `public/` path is explicitly made public.

#### DynamoDB Shared Table (plugin-data)

Plugin-specific data is stored in a shared table.
The plugin name is included in the PK, and IAM condition keys enforce row-level access control.

```
ampless-plugin-data table
  PK: "plugin#{pluginName}"
  SK: freely determined by the plugin
  data: JSON
```

```json
{"PK": "plugin#contact-form", "SK": "submission#2026-04-04#001", "data": {"name": "Tanaka", "email": "..."}}
{"PK": "plugin#contact-form", "SK": "submission#2026-04-04#002", "data": {"name": "Suzuki", "email": "..."}}
{"PK": "plugin#analytics",    "SK": "pageview#2026-04-04",       "data": {"count": 1234}}
```

IAM policy restricts each plugin to its own PK only:

```json
{
  "Effect": "Allow",
  "Action": ["dynamodb:Query", "dynamodb:PutItem", "dynamodb:DeleteItem"],
  "Resource": "arn:aws:dynamodb:*:*:table/ampless-plugin-data",
  "Condition": {
    "ForAllValues:StringLike": {
      "dynamodb:LeadingKeys": ["plugin#contact-form"]
    }
  }
}
```

#### Why Dedicated Tables Are Avoided
- Table creation requires a CDK deployment (= git push), which conflicts with admin UI-based installation (Method B)
- There is a soft limit on the number of tables per AWS account (default 2,500)
- Cleanup on plugin removal becomes complex
- Shared table Single Table Design is DynamoDB best practice

#### Access Permissions by trust_level

| trust_level | DynamoDB (plugin-data) | S3 public/ | S3 private/ |
|-------------|----------------------|------------|-------------|
| untrusted | None | None | None |
| trusted | Read (own PK) | Read (own path) | None |
| privileged | Read/write (own PK) | Read/write (own path) | Read/write (own path) |

trusted can read S3 public because that data is already publicly accessible via HTTP.
private is restricted to privileged only because it may contain sensitive data.

### External Network Control
- untrusted/trusted Lambdas have internet access enabled by default
- Mitigation option: place in VPC private subnet (no NAT) → complete isolation
- Practical decision: plugins can only read publicly available content, so leakage impact is low
  → No VPC restrictions in v1. VPC placement is considered for privileged Lambda on a case-by-case basis

---
