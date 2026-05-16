'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
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
      <Toolbar editor={editor} />
      {editor && <ImageBubbleMenu editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  )
}
