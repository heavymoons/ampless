'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Table as TableIcon } from 'lucide-react'
import { Button, cn } from '@ampless/runtime/ui'
import { useT } from '../components/i18n-provider.js'

interface TableControlsProps {
  editor: Editor
}

// Custom popover (no `@radix-ui/react-popover` dependency in this repo).
// Outside-click closes; Escape closes; the trigger toggles. Sized to sit
// in the toolbar like the existing MediaPicker trigger.
export function TableControls({ editor }: TableControlsProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current) return
      if (e.target instanceof Node && rootRef.current.contains(e.target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const inTable = editor.isActive('table')

  const items: Array<{
    key: string
    label: string
    run: () => void
    enabled: boolean
  }> = [
    {
      key: 'insert',
      label: t('editor.table.insert'),
      run: () =>
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      enabled: !inTable,
    },
    {
      key: 'addRowBefore',
      label: t('editor.table.addRowBefore'),
      run: () => editor.chain().focus().addRowBefore().run(),
      enabled: inTable && editor.can().addRowBefore(),
    },
    {
      key: 'addRowAfter',
      label: t('editor.table.addRowAfter'),
      run: () => editor.chain().focus().addRowAfter().run(),
      enabled: inTable && editor.can().addRowAfter(),
    },
    {
      key: 'addColumnBefore',
      label: t('editor.table.addColumnBefore'),
      run: () => editor.chain().focus().addColumnBefore().run(),
      enabled: inTable && editor.can().addColumnBefore(),
    },
    {
      key: 'addColumnAfter',
      label: t('editor.table.addColumnAfter'),
      run: () => editor.chain().focus().addColumnAfter().run(),
      enabled: inTable && editor.can().addColumnAfter(),
    },
    {
      key: 'deleteRow',
      label: t('editor.table.deleteRow'),
      run: () => editor.chain().focus().deleteRow().run(),
      enabled: inTable && editor.can().deleteRow(),
    },
    {
      key: 'deleteColumn',
      label: t('editor.table.deleteColumn'),
      run: () => editor.chain().focus().deleteColumn().run(),
      enabled: inTable && editor.can().deleteColumn(),
    },
    {
      key: 'toggleHeaderRow',
      label: t('editor.table.toggleHeaderRow'),
      run: () => editor.chain().focus().toggleHeaderRow().run(),
      enabled: inTable && editor.can().toggleHeaderRow(),
    },
    {
      key: 'deleteTable',
      label: t('editor.table.deleteTable'),
      run: () => editor.chain().focus().deleteTable().run(),
      enabled: inTable && editor.can().deleteTable(),
    },
  ]

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        className={cn(inTable && 'bg-accent text-accent-foreground')}
        title={t('editor.table.title')}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <TableIcon className="h-4 w-4" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-[12rem] rounded-md border bg-popover p-1 shadow"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={!item.enabled}
              onClick={() => {
                if (!item.enabled) return
                item.run()
                setOpen(false)
              }}
              className={cn(
                'block w-full rounded-sm px-2 py-1 text-left text-sm',
                item.enabled
                  ? 'hover:bg-accent hover:text-accent-foreground'
                  : 'cursor-not-allowed text-muted-foreground opacity-50'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
