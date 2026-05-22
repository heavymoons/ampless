---
"@ampless/runtime": minor
"@ampless/admin": minor
---

Markdown renderer overhaul + tiptap rich extensions.

`@ampless/runtime`: replaces the minimal hand-rolled markdown parser in `renderMarkdown` with `marked` v14 + GFM, so posts in `format: 'markdown'` now render the full set of common constructs — tables, task lists, h3–h6, links, images, blockquotes, ordered lists, italic, strikethrough, horizontal rules, autolinks. `renderTiptap`, `tiptapToMarkdown`, and `htmlToMarkdown` learn the new node types (`table`/`tableRow`/`tableHeader`/`tableCell`, `taskList`/`taskItem`) and marks (`underline`, `highlight`, `textAlign` on paragraph/heading), so admin format switches preserve more of the document. Underline/highlight fall back to `<u>`/`<mark>` HTML tags in markdown (preserved across round trips); textAlign cannot be expressed in markdown and is dropped on conversion.

`@ampless/admin`: tiptap editor gains `Table` (resizable), `TableRow`/`TableHeader`/`TableCell`, `TaskList`/`TaskItem`, `Underline`, `Highlight`, and `TextAlign` (heading + paragraph). Toolbar adds buttons for underline, strikethrough, highlight, task list, blockquote, horizontal rule, and four text-align directions, plus a table popover with insert + row/column add/remove + header toggle + delete. Tables, task lists, marks, and resize handles get minimal scoped CSS using existing theme tokens.
