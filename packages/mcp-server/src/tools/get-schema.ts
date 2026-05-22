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
        identifier: ['postId'],
        fields: {
          postId: { type: 'string', required: true, description: 'auto-generated if omitted on create' },
          slug: { type: 'string', required: true, description: 'URL slug, unique' },
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
        identifier: ['pageId'],
        fields: {
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
        identifier: ['mediaId'],
        fields: {
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
        'metadata.no_layout=true serves the post as bare HTML with no theme chrome — the public route at /<slug> 308-redirects to /_/<slug>, and that route renders the body verbatim with no wrapping <html>/<head>/layout. Use this for landing pages, embeds, or any post whose body is a full HTML document. Only meaningful with format=html (the other formats need the theme renderer).',
      staticFormat:
        'A fourth format value `static` exists on the underlying data model for posts whose body is a JSON manifest pointing to a pre-uploaded HTML/CSS/JS bundle in S3 at public/static/<slug>/. Public URL pattern: /_/<slug>/ for the entrypoint and /_/<slug>/<file> for every bundle file (308 redirect from /<slug> via the post dispatcher). Static posts are created/edited through the dedicated tools `upload_static_bundle` (zip in one shot), `upload_static_file` / `delete_static_file` (incremental per-file ops), and `commit_static_post` (rebuild the manifest from the current S3 prefix). `create_post` / `update_post` intentionally do NOT accept format=static — the bundle tools are the only supported entry point so the Post manifest stays in sync with the S3 prefix.',
    },
  }
}
