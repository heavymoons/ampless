'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Toolbar } from './toolbar'

interface TiptapEditorProps {
  initialContent?: unknown
  onChange?: (json: unknown) => void
}

export function TiptapEditor({ initialContent, onChange }: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
    ],
    content: initialContent ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'prose prose-neutral max-w-none min-h-[400px] px-4 py-3 focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON())
    },
  })

  return (
    <div className="rounded-md border">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}
