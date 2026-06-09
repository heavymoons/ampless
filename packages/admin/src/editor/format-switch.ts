// Pure helper for admin format-body conversion.
//
// Extracted from `post-form.tsx` so unit tests can exercise every conversion
// path with canned registries instead of mounting the full PostForm component
// (which has too many transitive deps for focused tests).
//
// The `static` format is NOT handled here — it switches to a pre-uploaded
// bundle manifest and does not involve body translation. The caller
// (`post-form.tsx`) must handle `static` before calling this helper.

import type { ContentFormat, TiptapNodeMarkdownAdapters, TiptapNodeHtmlAdapters } from 'ampless'
import {
  tiptapToHtml,
  tiptapToMarkdown,
  markdownToHtml,
  htmlToMarkdown,
} from '@ampless/runtime'
import { generateJSON } from '@tiptap/core'
import type { TiptapExtensionLike } from './admin-editor-extensions.js'

type ConvertibleFormat = Exclude<ContentFormat, 'static'>

export interface FormatSwitchRegistries {
  markdownAdapters: TiptapNodeMarkdownAdapters
  htmlAdapters: TiptapNodeHtmlAdapters
  editorExtensions: readonly TiptapExtensionLike[]
}

/**
 * Convert a post body from one format to another.
 *
 * @param body   The current body value.
 * @param from   The current format (must not be `'static'`).
 * @param to     The target format (must not be `'static'`).
 * @param registries  Live adapter registries from the admin bootstrap.
 * @returns The converted body value.
 *
 * Defensive no-op: if `from === to`, returns `body` unchanged. The caller
 * already short-circuits this case in production but the helper is safe
 * to call with identical formats (useful in tests).
 *
 * Conversion matrix:
 * - `tiptap → html`:     runtime consults the html adapter for embed nodes
 * - `tiptap → markdown`: runtime consults the markdown adapter for embed nodes
 * - `html → tiptap`:     pass the HTML string; tiptap editor parses on mount
 * - `html → markdown`:   turndown-style via `htmlToMarkdown`
 * - `markdown → tiptap`: convert to HTML first; tiptap editor parses on mount
 * - `markdown → html`:   2-hop: markdown→HTML (marked) → `generateJSON`
 *                         (applies plugin parseHTML rules to promote bare URL
 *                         paragraphs to embed Nodes) → `tiptapToHtml` with
 *                         html adapter (serialises embed Nodes to placeholder
 *                         divs). No duplicate logic — plugins only export the
 *                         `tiptap→html` adapter and the parseHTML rules handle
 *                         both directions.
 */
export function convertBodyFormat(
  body: unknown,
  from: ConvertibleFormat,
  to: ConvertibleFormat,
  registries: FormatSwitchRegistries,
): unknown {
  if (from === to) return body

  const k = `${from}→${to}` as const
  switch (k) {
    case 'tiptap→html':
      return tiptapToHtml(body, { nodeAdapters: registries.htmlAdapters })
    case 'markdown→html': {
      // 2-hop via tiptap: marked emits bare URL line as <p><a>URL</a></p>,
      // the embed plugins' Node.parseHTML rule promotes it to the embed
      // Node, then the html adapter serialises to the placeholder div.
      const html1 = markdownToHtml(String(body ?? ''))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = generateJSON(html1, registries.editorExtensions as readonly any[])
      return tiptapToHtml(doc, { nodeAdapters: registries.htmlAdapters })
    }
    case 'tiptap→markdown':
      return tiptapToMarkdown(body, { nodeAdapters: registries.markdownAdapters })
    case 'markdown→tiptap':
      return markdownToHtml(String(body ?? ''))
    case 'html→tiptap':
      return String(body ?? '')
    case 'html→markdown':
      return htmlToMarkdown(String(body ?? ''))
    // Same-format no-ops + the static cases never reach here (handled by caller).
  }
}
