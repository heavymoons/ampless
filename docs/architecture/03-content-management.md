> 日本語版: [03-content-management.ja.md](./03-content-management.ja.md)
> 
## 3. Content Management

### Editor

**tiptap (MIT)** is the rich-text editor used by the admin app.

- Headless editor on top of ProseMirror. Framework-agnostic.
- Wide MIT extension catalogue covers the editor surface ampless ships today.
- Paid tiptap features (real-time collaboration, AI) are not used.

The admin loads the following extensions ([`packages/admin/src/editor/tiptap-editor.tsx`](../../packages/admin/src/editor/tiptap-editor.tsx)):

- `StarterKit` (paragraph / heading / lists / code block / blockquote / hr / hard break / inline marks)
- `Link`, `Image` (extended with a custom `display` attribute for `inline` / `lightbox` rendering)
- `Table`, `TableRow`, `TableHeader`, `TableCell` (resizable columns)
- `TaskList`, `TaskItem` (nested)
- `Underline`, `Highlight`, `TextAlign`

The same node set has a server-side renderer in [`packages/runtime/src/rendering.ts`](../../packages/runtime/src/rendering.ts) so SSR output is symmetric with what the editor produces.

#### Editor Selection Rationale

| Candidate | Reason for rejection |
|-----------|---------------------|
| @portabletext/editor (Sanity) | MIT, but React-only. Small extension ecosystem. Strong Sanity branding |
| Lexical (Meta) | MIT. Strong candidate, but fewer CMS-oriented extensions than tiptap |
| Plate (Slate-based) | MIT. Good shadcn/ui integration, but less mature than tiptap |

### Data Model: Multi-Format Storage

Posts and Pages carry an explicit `format` field. The `body` column is JSON, but its shape depends on `format`:

| `format` | `body` payload | Typical use case |
|----------|----------------|------------------|
| `tiptap` | tiptap document JSON (`{ type: 'doc', content: [...] }`) | WYSIWYG editing in the admin |
| `markdown` | Markdown source string | Developers, git push workflows, AI agents |
| `html` | HTML source string | Imported content, hand-authored HTML |
| `static` | Bundle manifest (see below) | Pre-built HTML/CSS/JS bundles uploaded as a unit |

The model lives at [`packages/backend/src/data/index.ts`](../../packages/backend/src/data/index.ts) and the runtime types at [`packages/ampless/src/types.ts`](../../packages/ampless/src/types.ts).

**Design notes**

- There is always exactly one canonical body. Format conversion is best-effort and only invoked when the editor switches `format` mid-edit (see [`tiptapToHtml` / `htmlToMarkdown` / `tiptapToMarkdown` / `markdownToHtml`](../../packages/runtime/src/rendering.ts)).
- DynamoDB items stay lightweight — the 400 KB item limit applies, so very large bodies (image-heavy HTML, embedded base64, etc.) are an explicit anti-pattern.
- `format: 'static'` deliberately keeps the bytes out of DynamoDB by storing only a manifest; the actual files live in S3.

#### Rendering pipeline

The runtime renders the body **on demand** at request time — there is no "publish-time HTML cache in S3" step. The path is:

```
Browser → Next.js middleware (rewrite + Cache-Control) → theme dispatcher
        → renderBody(post) (packages/runtime/src/rendering.ts)
        → tiptap JSON | markdown | html → HTML string → theme component
```

The Cache-Control header is what makes the response cheap to re-serve — see "Cache strategy" below.

A handful of derived assets *are* materialised in S3, but they're maintained by plugins / event handlers rather than as part of the post body pipeline:

- `public/site-settings.json` — written by the trusted event processor whenever site settings change ([`packages/backend/src/events/processor-trusted.ts`](../../packages/backend/src/events/processor-trusted.ts)).
- `public/plugins/<plugin>/<key>` — anything a trusted plugin writes via `ctx.writePublicAsset` (RSS feeds, OG images, sitemap XML).
- `public/static/<slug>/...` — the file bytes for `format: 'static'` posts.

### Static-Bundle Posts

`format: 'static'` is for pre-built site fragments (landing pages, demos, archived HTML) that should be served verbatim with no theme chrome and no SSR pass through tiptap/marked.

- Body shape: `{ entrypoint, files, uploadedAt }` (`StaticPostBody` in [`packages/ampless/src/types.ts`](../../packages/ampless/src/types.ts)).
- File bytes live at `public/static/<slug>/...` in S3.
- Per-file size + mimeType lives on `post.metadata.files` (`{ [path]: { size, mimeType } }`) so the static delivery route can stream small files back through Lambda without a HEAD round-trip on first read. The upload tools (`upload_static_bundle`, `commit_static_post`, and the browser `uploadBundle`) populate this map automatically; legacy bundles that predate the field fall back to an Amplify SSR HEAD (cached in-process for 5 minutes).
- Public URL surface: middleware rewrites `/<slug>` to the entrypoint and `/<slug>/<path>` to any internal file ([`packages/runtime/src/middleware.ts`](../../packages/runtime/src/middleware.ts), [`packages/runtime/src/routes/static.ts`](../../packages/runtime/src/routes/static.ts)). Small files (<=6 MB) are streamed back through the Lambda response so Amplify Hosting's CloudFront edge cache can serve repeat reads; larger files fall back to a 302 presigned redirect. The route never sets `Cache-Control` itself — middleware overlays it from `post.metadata.cache` + `post.updatedAt`.
- Hard validation rule: every reference inside HTML/CSS/SVG must be **relative**. Absolute (`/foo`) and protocol-relative (`//cdn/foo`) paths are rejected at upload time so the bundle stays portable. Validation logic and entrypoint heuristics are shared between admin and MCP via [`packages/ampless/src/static-bundle.ts`](../../packages/ampless/src/static-bundle.ts).
- Upload entrypoints:
  - Admin UI: [`StaticUploader`](../../packages/admin/src/components/static-uploader.tsx) (drag in a zip).
  - MCP: `upload_static_bundle` (one-shot zip), `upload_static_file` / `delete_static_file` (incremental), and `commit_static_post` (rebuild the manifest from whatever is in S3). `create_post` / `update_post` deliberately reject `format=static` so the manifest can't drift from S3.

### Layout Modes

Per-post metadata controls how the theme wraps the rendered body. The dispatch decision lives in middleware (`packages/runtime/src/middleware.ts`) so the routing cost is one tiny AppSync projection per slug, cached for 60 s in Lambda warm memory.

| `format` / `metadata.no_layout` | Public URL | Middleware rewrites to | Renderer |
|---|---|---|---|
| themed (default) | `/<slug>` | (no rewrite) | `app/[slug]/page.tsx` → theme `components.Post` |
| `metadata.no_layout: true` | `/<slug>` | `/raw/<slug>` | `app/raw/[slug]/route.ts` — bare HTML, no theme chrome |
| `format: 'static'` | `/<slug>` and `/<slug>/<path>` | `/static/<slug>(/...)` | `app/static/[slug]/[[...path]]/route.ts` — stream-back (small files) or 302 presigned (>6 MB) |

`raw` and `static` are reserved slugs as a consequence.

### Cache Strategy

`metadata.cache` (`'auto' | 'deep' | 'hot'`) plus `cms.config.cache.*` knobs determine the `Cache-Control` header middleware sets on the response.

- `auto` (default) — cool-down by edit time. Posts whose `updatedAt` is younger than `cache.cooldownMs` (default 1 h) emit `no-store` so editors see their latest save immediately. After the cooldown, middleware emits `s-maxage=cache.freshTtlSeconds` (default 300 s).
- `deep` — always long-cache (`cache.deepTtlSeconds`, default 1 h). Use for posts whose content is effectively frozen.
- `hot` — always `no-store`. Use for posts that change per request or update by the minute.

The full type definitions are on `PostMetadata` / `CacheStrategy` / `CacheConfig` in [`packages/ampless/src/types.ts`](../../packages/ampless/src/types.ts).

### Site Model

One Amplify deployment = one site. To run multiple sites, deploy separate Amplify environments.

This keeps the read path cacheable at the edge. Amplify Hosting's CloudFront cache key doesn't include `Host`, so a deployment that serves multiple domains can't safely cache SSR responses and has to force `Cache-Control: private, no-store`. Deploying per-site sidesteps that.

### Media Management

#### Storage

Uploaded media files land in S3 under `public/media/YYYY/MM/<epochMs>-<sanitizedName>`. The Media DynamoDB row stores only the relative `src`; the display URL is resolved at render time.

```json
{
  "mediaId": "photo-001",
  "src": "media/2026/04/1714400000000-photo.jpg",
  "mimeType": "image/jpeg",
  "size": 1024000,
  "delivery": "nextjs"
}
```

Bucket access policy ([`packages/backend/src/storage/index.ts`](../../packages/backend/src/storage/index.ts)):

- `public/media/*` — guest read, admin/editor read+write+delete.
- `public/plugins/*` — guest read, admin read+write+delete.
- `public/static/*` and `public/site-settings.json` — bucket-policy overrides applied in `defineAmplessBackend`.

#### Delivery

`cms.config.media.delivery` selects how URLs are built.

```typescript
// cms.config.ts
export default defineConfig({
  media: {
    delivery: 'nextjs',      // default — proxy via the admin's /api/media route
    // delivery: 's3-direct', // build direct S3 URLs (requires the public-read bucket policy)
  }
})
```

| Method | URL example | Behaviour |
|--------|------------|-----------|
| `nextjs` (default) | `/api/media/2026/04/photo.jpg` | The admin route handler ([`media-proxy.ts`](../../packages/admin/src/api/media-proxy.ts)) fetches the object from S3 via a short-lived presigned URL and streams the bytes back through the Lambda response with `Cache-Control: public, max-age=31536000, immutable`. CloudFront caches the response so repeat visitors don't re-invoke Lambda. Files larger than 6 MB fall back to a 302 presigned redirect (CloudFront miss, but the response stays under the Lambda buffered-response cap). The bucket stays private. Asset metadata (size, mimeType, etag) is read from the Media DynamoDB row via the public-keyed `getMediaBySrc` custom query so the route skips a HEAD round-trip on warm reads. Orphan / legacy assets without a Media row fall back to an Amplify SSR `getProperties` HEAD (memoised in-process for 5 minutes). |
| `s3-direct` | `https://<bucket>.s3.<region>.amazonaws.com/public/media/...` | Direct S3 URL. Requires the bucket's public-read policy to be active. Suitable when fronting with a CDN. |

The Media schema carries a free-form `metadata` JSON column alongside `size` and `mimeType`, plus a `bySrc` secondary index that lets the public `getMediaBySrc(src)` AppSync query resolve a row in one O(1) Query. Both the browser admin uploads (`/admin/media` gallery + the editor's image picker) and the MCP `upload_media` tool create a Media row on every successful upload, recording `metadata.etag` from the S3 PutObject response so the media-proxy can passthrough `ETag` headers without a HEAD round-trip. The `getMediaBySrc` query uses `allow.publicApiKey()` (same auth model as the public post queries — Amplify Gen 2 custom handlers don't accept `allow.guest()`) and returns only a narrow `PublicMedia` projection (`{ src, size, mimeType, metadata }`) so no other Media fields leak to guests.

URL resolution lives in [`publicMediaUrl`](../../packages/admin/src/lib/media.ts). The function reads `cms.config.media.delivery` and the project's `amplify_outputs.json` to assemble the right URL; templates re-export it from `lib/media.ts` so theme components only call `publicMediaUrl(src)`.

Where image optimisation matters, themes can wrap `publicMediaUrl` with `next/image`; ampless does not force a specific optimiser into the resolved URL.

#### Image Upload Pipeline

Image-format media goes through a client-side processing step before upload ([`packages/admin/src/components/image-upload-dialog.tsx`](../../packages/admin/src/components/image-upload-dialog.tsx)):

- Optional crop (`free` / 1:1 / 4:3 / 16:9 / 3:2).
- Longest-edge clamp (`media.processing.maxDimension`, default 2400 px).
- Output format (`webp` / `jpeg` / `original`) with quality slider (`media.processing.quality`, default 0.85). PNG inputs default to lossless WebP (`media.processing.losslessForPng`).
- The "useOriginal" checkbox bypasses processing entirely.

This keeps the server free of transcoding work — the bytes that hit S3 are exactly what the admin uploaded.

### Content Taxonomy

- **Tags** are stored as a `string[]` on the Post itself and denormalised into the `PostTag` table on every write. `PostTag` is `PK = tag`, `SK = "<publishedAt>#<postId>"`, so the public `listPostsByTag` query is one DynamoDB `Query` with newest-first ordering.
- **Categories** have a `Taxonomy` model in the schema but no current admin UI; the slot is reserved for a later release.
- **Pages** share the same `format` enum as Posts but have no tag relationship — they're meant for site furniture (About, Privacy, etc.).

### Extending the Schema

ampless ships a fixed set of models (Post, Page, Media, Taxonomy, PostTag, KvStore, McpToken). Custom content types are added in code by spreading `amplessSchemaModels(a)` into the user's own `a.schema({...})`:

```ts
// amplify/data/resource.ts
const schema = a.schema({
  ...amplessSchemaModels(a),
  Recipe: a.model({ /* ... */ }).authorization(/* ... */),
})
```

This is a deliberate trade-off versus WordPress's "everything in one `wp_posts` table" model and versus dynamic-schema CMSes — the user's models get full Amplify codegen, type inference, and IAM, at the cost of being a code change rather than an admin UI form.

### Migration from WordPress

WordPress migration is **planned, not yet implemented** (tracked in [docs/architecture/14-roadmap.md](./14-roadmap.md)). The intended scope when it lands:

- WXR file import for posts, pages, media, and taxonomies.
- Imported HTML stored verbatim as `format: 'html'`.
- WordPress plugins, themes, and Gutenberg blocks are explicitly out of scope.
- Custom post types and ACF fields require manual schema mapping (see "Extending the schema" above).

---
