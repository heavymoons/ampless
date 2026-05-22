> 日本語版: [03-content-management.ja.md](./03-content-management.ja.md)
> 
## 3. Content Management

### Editor

**tiptap (MIT)** is the chosen rich text editor.

- Headless editor based on ProseMirror. Framework-agnostic
- Rich Extensions ecosystem (drag-and-drop, slash commands, character count, etc.)
- EmDash also uses tiptap (with a Portable Text conversion layer)
- Paid tiptap features (real-time collaboration, AI, etc.) are not required. The MIT portion is sufficient

#### Editor Selection Rationale

| Candidate | Reason for rejection |
|-----------|---------------------|
| @portabletext/editor (Sanity) | MIT, but React-only. Small Extensions ecosystem. Strong Sanity branding |
| Lexical (Meta) | MIT. Strong candidate, but fewer CMS-oriented Extensions than tiptap |
| Plate (Slate-based) | MIT. Good shadcn/ui integration, but less mature than tiptap |

### Data Model: Multi-Format Storage

The system is designed to let users choose their preferred content storage format.

#### Canonical (source of truth) — stored in DynamoDB

The format the user edits in is stored as the canonical form in DynamoDB.
The `format` field declares the format explicitly.

```json
{
  "siteId": "default",
  "postId": "post-001",
  "title": "Post title",
  "format": "tiptap",
  "body": { "type": "doc", "content": [...] },
  "updatedAt": "2026-04-04T..."
}
```

| format | body contents | Intended users |
|--------|--------------|---------------|
| `tiptap` | tiptap JSON | WYSIWYG editor users |
| `markdown` | Markdown string | Developers, git push workflow |
| `html` | HTML string | WordPress migrants, legacy content |

#### Derived formats — cached in S3

When publishing, derived formats converted from the canonical form are stored in S3.

```
[On save/publish]
  canonical (DynamoDB) → HTML → S3 (for delivery)
  canonical (DynamoDB) → Markdown → S3 (for export, when needed)
  canonical (DynamoDB) → RSS XML → S3
```

S3 content is treated as a regenerable cache at all times.

#### Format Conversion

Changing the canonical format (e.g., migrating from tiptap to Markdown) is supported.
Conversions may be lossy and require user confirmation before proceeding.

| Conversion | Library | Quality |
|-----------|---------|---------|
| tiptap JSON ↔ HTML | `@tiptap/html` (official) | Near-lossless |
| tiptap JSON ↔ Markdown | `tiptap-markdown` (community) | Lossy (decorations, custom blocks) |
| Markdown → HTML | `markdown-it` etc. | Lossless |
| HTML → tiptap JSON | `@tiptap/html` `generateJSON()` | Near-lossless |

#### Design Principles
- There is always exactly one canonical format. Multiple canonicals are never maintained (avoids sync hell)
- DynamoDB stores only the canonical form plus metadata, keeping items lightweight
- Derived formats are cached in S3
- The DynamoDB 400 KB item size limit is respected; oversized content is offloaded to S3

### Site Model

One Amplify deployment = one site. To run multiple sites, deploy separate Amplify environments.

The schema keeps a `siteId` column, but the value is always the literal `"default"` and is otherwise meaningless today — it's a forward-compat hook in case multi-site is ever re-introduced.

An in-deploy multi-site mode existed previously (one deployment serving multiple domains via middleware host routing). It was removed because Amplify Hosting's CloudFront cache key doesn't include Host, so SSR responses could not be safely cached at the edge and the middleware had to force `Cache-Control: private, no-store`. The edge-cache cost on the read path turned out to be larger than the operational cost of deploying per-site (which every operator was already doing).

### Media Management

#### Storage

Uploaded media files are stored in S3 under `public/media/`.
Only relative paths are stored in DynamoDB; delivery URLs are resolved at render time.

```json
{
  "mediaId": "photo-001",
  "src": "media/2026/04/photo.jpg",
  "mimeType": "image/jpeg",
  "size": 1024000,
  "delivery": "nextjs"
}
```

#### Delivery

The default delivery method is proxying through `next/image`. This can be changed explicitly in `cms.config.ts`.

```typescript
// cms.config.ts
export default defineConfig({
  media: {
    delivery: 'nextjs',     // default: via next/image (auto-optimization)
    // delivery: 's3-direct', // use direct S3 URLs
  }
})
```

| Method | URL example | Use case |
|--------|------------|---------|
| `nextjs` (default) | `/_next/image?url=...` | Images (WebP conversion, resizing, lazy loading) |
| `s3-direct` | `https://{bucket}.s3.amazonaws.com/public/...` | Videos, PDFs, large files |

MIME types that `next/image` cannot process (video, PDF, etc.) automatically fall back to `s3-direct` regardless of the configured setting.

#### URL Resolution

Only relative paths are stored in the database. At render time, `resolveMediaUrl()` converts them to full URLs.
If CloudFront is added in the future, updating only this function propagates the change everywhere.

```typescript
function resolveMediaUrl(src: string, mimeType: string, delivery: 'nextjs' | 's3-direct') {
  const isImage = mimeType.startsWith('image/')
  if (!isImage || delivery === 's3-direct') {
    return `https://${BUCKET}.s3.amazonaws.com/public/${src}`
  }
  return `/_next/image?url=${encodeURIComponent(`/api/media/${src}`)}&w=1200&q=75`
}
```

### Other
- Custom content types: define schema in the admin UI → DynamoDB table is generated
- Avoids the WordPress problem of cramming everything into a single `posts` table

### Migration from WordPress
- WXR file import is supported
- Migrates posts, pages, media, and taxonomies
- WordPress plugins and themes cannot be migrated (fundamentally different architecture)
- Custom post types (CPT) and ACF require manual schema mapping
- Imported HTML content can be stored as-is using `format: "html"`

---
