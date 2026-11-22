'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Table as TableIcon, Check } from 'lucide-react'
import { isValidCustomClassId } from 'ampless'
import { Button, cn } from '@ampless/runtime/ui'
import { useT } from '../components/i18n-provider.js'
import { useTableClasses } from './table-classes-context.js'

/** Current table's `customClass` (null outside a table or when unset). */
function currentTableClass(editor: Editor): string | null {
  if (!editor.isActive('table')) return null
  const v = editor.getAttributes('table').customClass
  return isValidCustomClassId(v) ? v : null
}

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
  const themeClasses = useTableClasses()
  // Synced with the selection so the trigger shows the active table style.
  const [activeClass, setActiveClass] = useState<string | null>(() => currentTableClass(editor))

  useEffect(() => {
    const sync = () => setActiveClass(currentTableClass(editor))
    sync()
    editor.on('selectionUpdate', sync)
    editor.on('transaction', sync)
    return () => {
      editor.off('selectionUpdate', sync)
      editor.off('transaction', sync)
    }
  }, [editor])

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

  // Style options: Default (no class), every class the active theme
  // declares, and — if the table carries an id the theme does not declare
  // (e.g. after a theme switch) — that id, flagged, so it is visible and
  // can be replaced instead of being silently dropped.
  const declared = themeClasses.find((c) => c.id === activeClass)
  const unknownActive = activeClass !== null && !declared
  const styleLabel = declared?.label ?? activeClass
  const setStyle = (id: string | null) => {
    editor.chain().focus().updateAttributes('table', { customClass: id }).run()
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        className={cn(inTable && 'bg-accent text-accent-foreground')}
        title={styleLabel ? t('editor.table.titleWithStyle', { style: styleLabel }) : t('editor.table.title')}
        aria-expanded={open}
        aria-haspopup="menu"
        data-table-style={activeClass ?? undefined}
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
          {inTable && (
            <div role="group" aria-label={t('editor.table.style')} className="mt-1 border-t pt-1">
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                {t('editor.table.style')}
              </div>
              {[
                { id: null as string | null, label: t('editor.table.styleDefault'), description: undefined as string | undefined, unknown: false },
                ...themeClasses.map((c) => ({ id: c.id as string | null, label: c.label, description: c.description, unknown: false })),
                ...(unknownActive
                  ? [{ id: activeClass, label: t('editor.table.styleUnknown', { id: activeClass ?? '' }), description: t('editor.table.styleUnknownHint'), unknown: true }]
                  : []),
              ].map((opt) => {
                const selected = opt.id === activeClass
                return (
                  <button
                    key={opt.id ?? '__default'}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    title={opt.description}
                    onClick={() => setStyle(opt.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                      opt.unknown && 'text-amber-700 dark:text-amber-400',
                    )}
                  >
                    <Check className={cn('h-3.5 w-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
                    <span>{opt.label}</span>
                  </button>
                )
              })}
              {themeClasses.length === 0 && (
                <div className="px-2 py-1 text-xs text-muted-foreground">{t('editor.table.styleNoneDeclared')}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
