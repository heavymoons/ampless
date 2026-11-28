// Static, hand-curated schema description. Post/Page/Media types are
// fixed today; a future custom-content-type system will make this
// dynamic.

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
          format: {
            type: 'enum',
            values: ['tiptap', 'markdown', 'html', 'static'],
            required: true,
            description:
              '`static` is read-only here — get_post / list_posts can return it, but it is created/edited only via the static-bundle tools (upload_static_bundle, upload_static_file, delete_static_file, commit_static_post), NOT create_post / update_post. See notes.staticFormat.',
          },
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
              'Free-form per-post key/value bag. Reserved well-known keys (owned by ampless): `no_layout` (boolean), `cache` (auto|deep|hot), `ampless:postClasses` (tagged post-classes value, see notes.postClasses). Other keys pass through unchanged for themes/plugins.',
          },
          version: {
            type: 'string',
            description:
              'Output only (get_post and the tools that return a full post; not list_posts summaries): content version token `v1:<sha256>` over every other returned field, including updatedAt. Pass it as `expectedVersion` to update_post / set_post_classes. Not stored; never send it as a field to write. See notes.concurrency.',
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
    formats: ['tiptap', 'markdown', 'html', 'static'],
    notes: {
      editorTrust:
        'editor stores arbitrary HTML/JS verbatim — same trust shape as WordPress unfiltered_html capability. See https://github.com/heavymoons/ampless/wiki/architecture-04-access-layer-mcp §"editor の信頼モデル".',
      tiptapBody:
        'When format=tiptap, body is the tiptap document JSON: { type: "doc", content: [...] }. The renderer expects this shape.',
      noLayout:
        'metadata.no_layout=true serves the post as bare HTML with no theme chrome — middleware rewrites the public /<slug> request to the internal bare-HTML handler, which renders the body verbatim with no wrapping <html>/<head>/layout. Use this for landing pages, embeds, or any post whose body is a full HTML document. Only meaningful with format=html (the other formats need the theme renderer).',
      staticFormat:
        'A fourth format value `static` exists on the underlying data model for posts whose body is a JSON manifest pointing to a pre-uploaded HTML/CSS/JS bundle in S3 at public/static/<slug>/. Public URL pattern: /<slug>/ for the entrypoint and /<slug>/<file> for every bundle file (middleware rewrites both to an internal static-bundle handler). Static posts are created/edited through the dedicated tools `upload_static_bundle` (zip in one shot), `upload_static_file` / `delete_static_file` (incremental per-file ops), and `commit_static_post` (rebuild the manifest from the current S3 prefix). `create_post` / `update_post` intentionally do NOT accept format=static — the bundle tools are the only supported entry point so the Post manifest stays in sync with the S3 prefix.',
      postClasses:
        'Theme post classes live in metadata["ampless:postClasses"] as exactly `{ "kind": "ampless.post-classes", "version": 1, "ids": ["wide"] }`; each id renders as class `ampless-post--<id>` on the theme\'s post body wrapper. Ids are lowercase letters, digits and hyphens (max 64). Any other value under that key is ignored by the renderer and left alone by ampless writers; a plain `postClasses` key is never read. Post classes are not applied to static posts or no_layout HTML posts. Use set_post_classes to change them without touching other metadata. This server cannot see the active theme, so ids are only syntax-checked — the theme manifest\'s customClasses (target "post") lists the ids it styles.',
      concurrency:
        'Every post write sets `updatedAt` server-side, with millisecond precision — two writes in the same millisecond can leave it unchanged, so updatedAt alone is not a safe version. Use `version` instead: get_post (and every tool returning a full post) returns `version` = `v1:` + sha256 of the canonical JSON of the returned post (postId, title, slug, excerpt, format, body, status, publishedAt, tags, metadata, updatedAt), so ANY content change changes it, whatever happened to updatedAt. Guarantee: a write made with `expectedVersion` (update_post, set_post_classes) never overwrites a change made after the read that version came from — including a same-millisecond write by a stock / legacy writer that left updatedAt unchanged. The tool re-reads the post, fails unless that read\'s version equals yours, then writes through the atomic `amplessUpdatePostIfUnchanged` mutation conditioned on every field of that read (which also always sets a strictly newer updatedAt), closing the window between its read and its write. set_post_classes `add` / `remove` without `expectedVersion` read, apply, and write conditioned on the metadata / format / updatedAt they read, re-reading and re-applying on a conflict (3 attempts in total); `ids` (full replacement) requires `expectedVersion`. On a conflict nothing is saved: call get_post again, re-apply your change, and retry with the new version. NOT guaranteed: unconditional writers can still overwrite anything, including a guarded write — update_post without `expectedVersion`, the static bundle tools (upload_static_bundle / upload_static_file / delete_static_file / commit_static_post), and any stock `updatePost` caller (older admin clients, external GraphQL). Concurrent static bundle writes to the same slug are NOT made safe by any of this (the S3 prefix is overwritten in place and the Post row is saved unconditionally); that needs a separately reviewed design. A backend without the mutation (not upgraded with `create-ampless upgrade`) makes the guarded calls fail with nothing saved — they never fall back to an unconditional write.',
      cacheStrategy:
        "metadata.cache controls the response Cache-Control header (set by middleware). Values:\n  - 'auto' (default): cooldown by edit time. Posts updated within cms.config.cache.cooldownMs (default 1h) emit `public, max-age=0, must-revalidate, s-maxage=0` so editors see fresh content immediately; older posts emit `public, max-age=<freshTtlSeconds>, s-maxage=<freshTtlSeconds>` (default 300 sec / 5 min).\n  - 'deep': always `public, max-age=<deepTtlSeconds>, s-maxage=<deepTtlSeconds>` (default 3600 sec / 1 hour). Use for posts whose content is fixed for the foreseeable future.\n  - 'hot': always `public, max-age=0, must-revalidate, s-maxage=0`. Use for rapidly-evolving posts or posts whose body is computed per request.\nIndependent of metadata.no_layout and post.format — applies uniformly to themed, no_layout, and static posts. Override the defaults per project via `cms.config.cache` ({ cooldownMs, freshTtlSeconds, deepTtlSeconds }).",
    },
  }
}
