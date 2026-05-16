// Back-compat shim. Body rendering + format converters moved to
// `@ampless/runtime` (L1 extraction). The renderer is reachable
// directly via `ampless.renderBody`, but theme files and the admin
// post form still import these names from `@/lib/posts`.

export {
  renderBody,
  tiptapToHtml,
  markdownToHtml,
  tiptapToMarkdown,
  htmlToMarkdown,
} from '@ampless/runtime'
