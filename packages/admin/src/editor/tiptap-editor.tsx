'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Underline } from '@tiptap/extension-underline'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlign } from '@tiptap/extension-text-align'
import { Toolbar } from './toolbar.js'
import { ImageBubbleMenu } from './image-bubble-menu.js'

// Extend the Image extension with a per-image `display` attribute
// ("inline" | "lightbox" | null). null means "fall back to cms.config".
const AmplessImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      display: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-display'),
        renderHTML: (attrs) => {
          const v = attrs.display as string | null
          return v ? { 'data-display': v } : {}
        },
      },
    }
  },
})

// Inline styles for ProseMirror-rendered tiptap content inside the
// editor. The public-facing rendering lives in templates (typically via
// Tailwind Typography), so this only needs to cover the editing surface
// — Tailwind `prose` doesn't style data-attribute-driven nodes
// (taskList / taskItem) or tiptap's column resize handle, and the
// admin package ships no CSS file of its own. Scoped to `.ProseMirror`
// so it can't leak outside the editor.
const EDITOR_STYLES = `
.ProseMirror .tiptap-table,
.ProseMirror table {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
  margin: 0.75em 0;
  overflow: hidden;
}
.ProseMirror .tiptap-table td,
.ProseMirror .tiptap-table th,
.ProseMirror table td,
.ProseMirror table th {
  border: 1px solid var(--border);
  padding: 0.4em 0.6em;
  min-width: 1em;
  vertical-align: top;
  position: relative;
}
.ProseMirror .tiptap-table th,
.ProseMirror table th {
  background: var(--muted);
  font-weight: 600;
  text-align: left;
}
.ProseMirror .tiptap-table .selectedCell,
.ProseMirror table .selectedCell {
  background: var(--accent);
}
.ProseMirror .tableWrapper {
  overflow-x: auto;
  margin: 0.75em 0;
}
.ProseMirror .column-resize-handle {
  position: absolute;
  right: -2px;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--ring);
  pointer-events: none;
}
.ProseMirror.resize-cursor {
  cursor: col-resize;
}

.ProseMirror ul[data-type='taskList'] {
  list-style: none;
  padding-left: 0;
}
.ProseMirror ul[data-type='taskList'] li {
  display: flex;
  align-items: flex-start;
  gap: 0.5em;
}
.ProseMirror ul[data-type='taskList'] li > label {
  flex: 0 0 auto;
  margin-top: 0.25em;
  user-select: none;
}
.ProseMirror ul[data-type='taskList'] li > div {
  flex: 1 1 auto;
  min-width: 0;
}
.ProseMirror ul[data-type='taskList'] li[data-checked='true'] > div {
  text-decoration: line-through;
  color: var(--muted-foreground);
}

.ProseMirror mark {
  background: #fef08a;
  color: inherit;
  padding: 0 0.1em;
  border-radius: 2px;
}
`

interface TiptapEditorProps {
  initialContent?: unknown
  onChange?: (json: unknown) => void
}

export function TiptapEditor({ initialContent, onChange }: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      AmplessImage.configure({ inline: false, allowBase64: false }),
      Table.configure({ resizable: true, HTMLAttributes: { class: 'tiptap-table' } }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Underline,
      Highlight.configure({ multicolor: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: initialContent ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose prose-neutral dark:prose-invert max-w-none min-h-[400px] px-4 py-3 focus:outline-none',
      },
    },
    onCreate: ({ editor }) => {
      // Tiptap accepts both JSON docs and HTML strings as initial
      // content — when given HTML it parses to the internal doc on
      // mount but doesn't fire onUpdate (no user edit yet). Fire
      // onChange here so the parent's `body` state matches the
      // parsed JSON immediately. Otherwise a format-switch sequence
      // like markdown → tiptap → markdown leaves the parent holding
      // a raw HTML string the second time around, and converters
      // that expect a JSON doc return empty.
      onChange?.(editor.getJSON())
    },
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON())
    },
  })

  return (
    <div className="rounded-md border">
      <style>{EDITOR_STYLES}</style>
      <Toolbar editor={editor} />
      {editor && <ImageBubbleMenu editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  )
}
