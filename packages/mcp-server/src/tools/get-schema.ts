// Static, hand-curated schema description. v0.1 has fixed Post/Page/Media
// types — when v0.2 adds custom content types, this becomes dynamic.

export const getSchemaSchema = {
  type: 'object',
  properties: {},
} as const

export function getSchema() {
  return {
    contentTypes: [
      {
        name: 'post',
        identifier: ['siteId', 'postId'],
        fields: {
          siteId: { type: 'string', required: true },
          postId: { type: 'string', required: true, description: 'auto-generated if omitted on create' },
          slug: { type: 'string', required: true, description: 'URL slug, unique per site' },
          title: { type: 'string', required: true },
          excerpt: { type: 'string' },
          format: { type: 'enum', values: ['tiptap', 'markdown', 'html'], required: true },
          body: {
            type: 'json',
            description:
              'tiptap node JSON when format=tiptap; markdown source string when format=markdown; raw HTML string when format=html',
          },
          status: { type: 'enum', values: ['draft', 'published'], default: 'draft' },
          publishedAt: { type: 'datetime', description: 'ISO 8601' },
          tags: { type: 'string[]' },
          metadata: {
            type: 'json',
            description:
              'Free-form per-post key/value bag. Reserved well-known keys (owned by ampless): `no_layout` (boolean). Other keys pass through unchanged for themes/plugins.',
          },
        },
      },
      {
        name: 'page',
        identifier: ['siteId', 'pageId'],
        fields: {
          siteId: { type: 'string', required: true },
          pageId: { type: 'string', required: true },
          slug: { type: 'string', required: true },
          title: { type: 'string', required: true },
          format: { type: 'enum', values: ['tiptap', 'markdown', 'html'], required: true },
          body: { type: 'json' },
          status: { type: 'enum', values: ['draft', 'published'] },
          publishedAt: { type: 'datetime' },
        },
      },
      {
        name: 'media',
        identifier: ['siteId', 'mediaId'],
        fields: {
          siteId: { type: 'string', required: true },
          mediaId: { type: 'string', required: true },
          src: { type: 'string', required: true, description: 'S3 key' },
          mimeType: { type: 'string', required: true },
          size: { type: 'integer' },
          delivery: { type: 'string' },
        },
      },
    ],
    formats: ['tiptap', 'markdown', 'html'],
    notes: {
      editorTrust:
        'editor stores arbitrary HTML/JS verbatim — same trust shape as WordPress unfiltered_html capability. See docs/architecture/04-access-layer-mcp.md §"editor の信頼モデル".',
      tiptapBody:
        'When format=tiptap, body is the tiptap document JSON: { type: "doc", content: [...] }. The renderer expects this shape.',
      noLayout:
        'metadata.no_layout=true serves the post as bare HTML with no theme chrome — the public route at /<slug> 302-redirects to /raw/<slug>, and that route renders the body verbatim with no wrapping <html>/<head>/layout. Use this for landing pages, embeds, or any post whose body is a full HTML document. Only meaningful with format=html (the other formats need the theme renderer).',
      staticFormat:
        'A fourth format value `static` exists on the underlying data model for posts whose body is a JSON manifest pointing to a pre-uploaded HTML/CSS/JS bundle in S3 at public/static/<siteId>/<slug>/. Static uploads currently only flow through the admin UI; the MCP `upload_media` tool writes to public/media/ and does not handle static bundles. Use the admin StaticUploader for now.',
    },
  }
}
