'use client'

import type { Editor } from '@tiptap/react'
import { Bold, Italic, Heading1, Heading2, List, ListOrdered, Code, Link as LinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

interface ToolbarProps {
  editor: Editor | null
}

export function Toolbar({ editor }: ToolbarProps) {
  if (!editor) return null

  const tools = [
    { name: 'bold', icon: Bold, action: () => editor.chain().focus().toggleBold().run(), isActive: () => editor.isActive('bold') },
    { name: 'italic', icon: Italic, action: () => editor.chain().focus().toggleItalic().run(), isActive: () => editor.isActive('italic') },
    { name: 'h1', icon: Heading1, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), isActive: () => editor.isActive('heading', { level: 1 }) },
    { name: 'h2', icon: Heading2, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), isActive: () => editor.isActive('heading', { level: 2 }) },
    { name: 'bulletList', icon: List, action: () => editor.chain().focus().toggleBulletList().run(), isActive: () => editor.isActive('bulletList') },
    { name: 'orderedList', icon: ListOrdered, action: () => editor.chain().focus().toggleOrderedList().run(), isActive: () => editor.isActive('orderedList') },
    { name: 'code', icon: Code, action: () => editor.chain().focus().toggleCodeBlock().run(), isActive: () => editor.isActive('codeBlock') },
  ]

  const setLink = () => {
    const url = window.prompt('URL')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().unsetLink().run()
      return
    }
    editor.chain().focus().setLink({ href: url }).run()
  }

  return (
    <div className="flex flex-wrap gap-1 border-b p-2">
      {tools.map((tool) => {
        const Icon = tool.icon
        return (
          <Button
            key={tool.name}
            type="button"
            variant="ghost"
            size="icon"
            onClick={tool.action}
            className={cn(tool.isActive() && 'bg-accent text-accent-foreground')}
          >
            <Icon className="h-4 w-4" />
          </Button>
        )
      })}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={setLink}
        className={cn(editor.isActive('link') && 'bg-accent text-accent-foreground')}
      >
        <LinkIcon className="h-4 w-4" />
      </Button>
    </div>
  )
}
