---
"ampless": minor
---

Promote `contentFields` capability from reserved to active and add `publicPostScript` capability (Phase 7 embed plugin extension). New types: `ContentFieldRenderer`, `TiptapRenderNode`, `MarkdownEmbedMatch`, `PublicPostScriptDescriptor`. `@types/react` declared as optional peer dep + dev dep so plugin authors get correct `ReactNode` types when they render `contentFields`.

This is purely additive — existing plugins that don't declare the new capabilities continue to work unchanged.
