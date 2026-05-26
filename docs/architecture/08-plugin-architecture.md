> 日本語版: [08-plugin-architecture.ja.md](./08-plugin-architecture.ja.md)
> 
## 8. Plugin Architecture

### Design Philosophy

ampless plugins run inside the same Lambda that processes events for their `trust_level` — the sandbox is **the Lambda's IAM execution role**, not a V8 isolate or `vm.Script` wrapper. There is no in-process JS sandbox: untrusted code runs in a Lambda whose IAM role has been pruned to nothing, and trusted code runs in a Lambda whose IAM role lists exactly what trusted plugins are allowed to touch.

This trades the fine-grained capability surface of a V8-isolate sandbox for AWS-native isolation: simpler to reason about, no native-binary dependency, no `--no-node-snapshot` flag, no custom container image.

### Plugin Contract

Plugins are plain TypeScript modules that export the result of `definePlugin()` ([`packages/ampless/src/plugin.ts`](../../packages/ampless/src/plugin.ts)). The shape:

```typescript
export interface AmplessPlugin {
  name: string
  apiVersion: 1
  trust_level: 'untrusted' | 'trusted' | 'privileged'

  // Event hooks — run in the trust_level-matched Lambda from SQS.
  hooks?: { [K in EventType]?: (event, ctx) => Promise<void> }

  // Per-post and site-level metadata — pure functions, called at request time.
  metadata?(post: Post, site): PluginMetadata
  siteMetadata?(site): PluginMetadata

  // Dynamic OG image — rendered at request time via Next.js ImageResponse.
  ogImage?: OgImageConfig
}
```

A plugin combines any of these surfaces. Activation is a single line in the project's `cms.config.ts`:

```typescript
plugins: [
  seoPlugin({ /* ... */ }),
  rssPlugin({ /* ... */ }),
]
```

### Trust Levels

#### `untrusted`

- **IAM**: SQS consume only. Zero data permissions.
- **Runtime context**: `listPublishedPosts()` and `writePublicAsset()` both throw on call.
- **Can do**: Pure JavaScript, outbound HTTP (the Lambda has internet egress).
- **Use cases**: webhook delivery, in-process content transforms, OG-image template rendering (which runs in the public Next.js process, not the untrusted Lambda).
- **First-party examples**: `@ampless/plugin-og-image`, `@ampless/plugin-webhook`.

#### `trusted`

- **IAM**: `dynamodb:Query` / `Scan` on Post + GSIs, `dynamodb:Read` on KvStore, `dynamodb:Write` on PostTag, `s3:PutObject` / `DeleteObject` under `public/plugins/*`, plus an exact-match grant on `public/site-settings.json` for the built-in site-settings handler.
- **Runtime context**: `listPublishedPosts()` does one Query against the `byStatus` GSI; `writePublicAsset(key, body, contentType)` writes to `public/plugins/{plugin}/{key}`.
- **Use cases**: SEO metadata, RSS feed generation, sitemap rebuild, custom index maintenance.
- **First-party examples**: `@ampless/plugin-seo`, `@ampless/plugin-rss`.

The trusted Lambda's S3 grant is bucket-wide on `public/plugins/*` rather than per-plugin. Rationale lives in `backend.ts`: trusted plugins are first-party-only (cross-plugin tampering isn't in the threat model), per-plugin enumeration breaks the IAM inline-policy size limit beyond ~50 plugins, and the runtime context already namespaces keys by plugin name so a plugin can't write to a sibling's prefix without bypassing it. Strict per-plugin isolation is on the [roadmap](./14-roadmap.md) via plugin-per-Lambda with capability-based IAM.

#### `privileged`

Reserved. The contract accepts `trust_level: 'privileged'` but no privileged Lambda is provisioned yet. The intended shape:

- One Lambda per privileged plugin.
- Plugin declares a capability list; CDK assembles an IAM policy from that list.
- Use cases: sending email (SES), persisting form submissions to its own table, calling external paid APIs, accessing private S3 prefixes.

This lands once the trusted/untrusted split has settled and a real privileged plugin requires it.

### How Plugins Run

| Surface | Where it runs | When it fires |
|---|---|---|
| `hooks` | `processor-trusted` or `processor-untrusted` Lambda (per `trust_level`) | SQS message arrives — i.e. after the originating DynamoDB write |
| `metadata` / `siteMetadata` | Public Next.js process (request thread) | Inside theme components / `generateMetadata()` |
| `ogImage` | Public Next.js process — typically `app/og/[slug]/route.ts` | When an OG-image URL is requested |

`hooks` is the async side of plugins. `metadata` / `siteMetadata` / `ogImage` are the sync side and execute inside the public site, with no AWS data permissions — they're pure or read-only over what's already passed in.

### Plugin State Storage

Plugins persist state through three mechanisms — none of them is a dedicated per-plugin DynamoDB table:

| Mechanism | Path / shape | Use |
|---|---|---|
| `writePublicAsset(key, body, contentType)` | S3 `public/plugins/{plugin}/{key}` | Rendered assets the public site fetches: RSS feed, sitemap XML, JSON indexes |
| `KvStore` (admin/editor-write via AppSync) | DynamoDB row `pk='pluginstate:{plugin}:...'` with optional TTL | Small state the plugin needs to read back later (counters, last-run timestamps) |
| `cms.config.ts` constructor args | Plugin factory arguments | Static configuration baked into the deploy |

There is no `private/plugins/` S3 prefix and no `ampless-plugin-data` table. If a plugin needs private storage, that's part of what the privileged tier will eventually grant.

### S3 Layout

```
s3://<bucket>/
  public/
    media/YYYY/MM/<epoch>-<name>          ← uploaded media
    plugins/{plugin}/{key}                ← trusted-plugin assets (writePublicAsset)
    static/{slug}/<file>                  ← format: 'static' post bundles
    site-settings.json                    ← cached site settings
```

Everything under `public/` is reachable through the bucket policy (or the `/api/media/...` proxy for media). Plugin writes are confined to `public/plugins/{plugin}/{key}` by the trusted runtime context.

### API Versioning

Plugins declare `apiVersion: 1`. ampless rejects plugins whose version it does not understand. Today there is only one supported version, so the field is a forward-compat handle, not a load-bearing branch.

```typescript
export default seoPlugin({/* config */}) // resolves to { apiVersion: 1, name: 'seo', ... }
```

### Plugin Manifest (npm-published plugins)

Third-party plugin packages publish a normal npm tarball with their factory exported as default. The "manifest" lives in the runtime object returned by the factory call; there is no separate JSON manifest file.

### Lambda Memory Configuration

| Lambda | Memory | Notes |
|---|---|---|
| `processor-untrusted` | 256 MB | Pure JS + outbound HTTP, fits comfortably. |
| `processor-trusted` | 512 MB | Headroom for built-in handlers + trusted-tier plugins running in series per SQS batch. |
| `mcp-handler` | 512 MB | Lambda Function URL with AppSync SigV4 + S3 PutObject. |

Cold start for these is ~200–400 ms on Node.js 22 — negligible for CMS workloads.

### External Network

untrusted and trusted Lambdas both have internet egress by default. The webhook plugin (untrusted) relies on it. Placing the Lambdas in a VPC private subnet to cut egress is an option but not the default — the leakage surface a plugin can reach is already only published content, so internet egress is not a meaningful exfiltration path against an honest operator.

### Not Adopted

- **`isolated-vm` / V8-isolate sandbox.** Requires `--no-node-snapshot` on Node ≥ 20, which means a container-image Lambda — worse cold starts, more maintenance, native-binary builds. IAM-based isolation is the chosen alternative.
- **`quickjs-emscripten` or similar in-process sandboxes.** Considered for a future marketplace tier, not used today.
- **Per-plugin DynamoDB tables.** Soft account limit of 2,500 tables, CDK-deploy cost per install, complex cleanup. KvStore + S3 covers what current plugins need.

---
