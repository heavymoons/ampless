---
"@ampless/runtime": minor
"@ampless/admin": patch
---

Preview now injects plugin publicHead scripts (via a non-gated `renderHeadForPreview`) so mermaid/highlight render in preview.

`PluginHeadApi` gains `renderHeadForPreview()` — identical to `renderHead()` but bypasses the `isPublicRequest()` gate. The admin post preview calls this to populate the preview document's `<head>` with all installed plugin head descriptors, including content-decoration scripts like mermaid and highlight.js that were previously absent from preview documents.
