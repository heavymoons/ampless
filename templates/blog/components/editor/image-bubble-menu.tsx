'use client'

import { BubbleMenu, type Editor } from '@tiptap/react'
import { Trash2, Pencil, ImageIcon, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

interface ImageBubbleMenuProps {
  editor: Editor
}

export function ImageBubbleMenu({ editor }: ImageBubbleMenuProps) {
  const editAlt = () => {
    const current = (editor.getAttributes('image').alt as string | undefined) ?? ''
    const alt = window.prompt('Alt text', current)
    if (alt === null) return
    editor.chain().focus().updateAttributes('image', { alt }).run()
  }

  const remove = () => {
    editor.chain().focus().deleteSelection().run()
  }

  const setDisplay = (display: 'inline' | 'lightbox') => {
    const current = (editor.getAttributes('image').display as string | undefined) ?? null
    // Click the already-active button to clear and fall back to site default.
    const next = current === display ? null : display
    editor.chain().focus().updateAttributes('image', { display: next }).run()
  }

  const currentDisplay = (editor.getAttributes('image').display as string | undefined) ?? null

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor }) => editor.isActive('image')}
      tippyOptions={{ duration: 100, placement: 'top' }}
    >
      <div className="flex items-center gap-1 rounded-md border bg-popover p-1 shadow">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setDisplay('inline')}
          className={cn(currentDisplay === 'inline' && 'bg-accent text-accent-foreground')}
          title="Force inline display"
        >
          <ImageIcon className="mr-1 h-3 w-3" />
          Inline
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setDisplay('lightbox')}
          className={cn(currentDisplay === 'lightbox' && 'bg-accent text-accent-foreground')}
          title="Force click-to-enlarge"
        >
          <Maximize2 className="mr-1 h-3 w-3" />
          Lightbox
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button type="button" variant="ghost" size="sm" onClick={editAlt}>
          <Pencil className="mr-1 h-3 w-3" />
          Alt
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={remove}>
          <Trash2 className="mr-1 h-3 w-3" />
          Delete
        </Button>
      </div>
    </BubbleMenu>
  )
}
