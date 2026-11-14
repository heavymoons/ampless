// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Editor, type AnyExtension, type JSONContent } from '@tiptap/core'
import type { Editor as ReactEditor } from '@tiptap/react'
import { BASE_TIPTAP_EXTENSIONS } from './base-extensions.js'
import { TableControls } from './table-controls.js'
import { TableClassesProvider, type EditorTableClass } from './table-classes-context.js'
import { I18nProvider } from '../components/i18n-provider.js'
import { resolveLocale } from '../lib/i18n.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const EXT = [...BASE_TIPTAP_EXTENSIONS] as unknown as AnyExtension[]
const THEME: EditorTableClass[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'striped', label: 'Striped', description: 'Zebra rows' },
]

const tableDoc = (customClass?: string): JSONContent => ({
  type: 'doc',
  content: [
    {
      type: 'table',
      ...(customClass ? { attrs: { customClass } } : {}),
      content: [
        {
          type: 'tableRow',
          content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }],
        },
      ],
    },
  ],
})

let root: Root | null = null
let container: HTMLElement | null = null
let editor: Editor | null = null

function mount(content: JSONContent, classes: EditorTableClass[]) {
  editor = new Editor({ extensions: EXT, content })
  let pos = 0
  editor.state.doc.descendants((node, p) => {
    if (!pos && node.type.name === 'paragraph') pos = p + 1
  })
  editor.commands.setTextSelection(pos)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const { locale, dict } = resolveLocale('en')
  act(() => {
    root!.render(
      <I18nProvider locale={locale} dict={dict}>
        <TableClassesProvider classes={classes}>
          <TableControls editor={editor as unknown as ReactEditor} />
        </TableClassesProvider>
      </I18nProvider>,
    )
  })
  return container
}
const trigger = () => container!.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
const openMenu = () => act(() => trigger().click())
const styleOptions = () => [...container!.querySelectorAll('[role="menuitemradio"]')] as HTMLButtonElement[]
const tableClass = () => editor!.getJSON().content?.[0]?.attrs?.customClass ?? null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  editor?.destroy()
  root = null
  container = null
  editor = null
})

describe('TableControls table style', () => {
  it('offers Default plus the active theme classes and applies the picked one', () => {
    mount(tableDoc(), THEME)
    openMenu()
    expect(styleOptions().map((b) => b.textContent)).toEqual(['Default', 'Compact', 'Striped'])
    expect(styleOptions()[0]!.getAttribute('aria-checked')).toBe('true')
    act(() => styleOptions()[1]!.click())
    expect(tableClass()).toBe('compact')
    expect(trigger().title).toBe('Table (style: Compact)')
    expect(trigger().dataset.tableStyle).toBe('compact')
    openMenu()
    expect(styleOptions()[1]!.getAttribute('aria-checked')).toBe('true')
  })

  it('flags an id the active theme does not declare instead of dropping it', () => {
    mount(tableDoc('retired-style'), THEME)
    expect(tableClass()).toBe('retired-style')
    openMenu()
    const opts = styleOptions()
    expect(opts.map((b) => b.textContent)).toEqual([
      'Default',
      'Compact',
      'Striped',
      'retired-style (not declared by the active theme)',
    ])
    expect(opts[3]!.getAttribute('aria-checked')).toBe('true')
    expect(trigger().title).toBe('Table (style: retired-style)')
    // still stored until the editor picks something else
    expect(tableClass()).toBe('retired-style')
    act(() => opts[0]!.click())
    expect(tableClass()).toBeNull()
  })

  it('explains when the theme declares no table styles, still allowing Default', () => {
    mount(tableDoc('compact'), [])
    openMenu()
    expect(styleOptions().map((b) => b.textContent)).toEqual(['Default', 'compact (not declared by the active theme)'])
    expect(container!.textContent).toContain('The active theme declares no table styles.')
  })
})
