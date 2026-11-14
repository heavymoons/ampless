// @vitest-environment jsdom

import { describe, it, expect } from 'vitest'
import { Editor, generateHTML, generateJSON, type AnyExtension, type JSONContent } from '@tiptap/core'
import { tiptapToHtml } from '@ampless/runtime'
import { BASE_TIPTAP_EXTENSIONS, parseTableCustomClass } from './base-extensions.js'

const EXT = [...BASE_TIPTAP_EXTENSIONS] as unknown as AnyExtension[]

const doc = (attrs?: Record<string, unknown>): JSONContent => ({
  type: 'doc',
  content: [
    {
      type: 'table',
      ...(attrs ? { attrs } : {}),
      content: [
        {
          type: 'tableRow',
          content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }],
        },
      ],
    },
  ],
})
const tableAttrs = (json: JSONContent) => json.content?.find((n) => n.type === 'table')?.attrs ?? {}

describe('parseTableCustomClass', () => {
  it('reads a valid id from the class list and ignores invalid ones', () => {
    expect(parseTableCustomClass('tiptap-table tiptap-table--compact')).toBe('compact')
    expect(parseTableCustomClass('foo tiptap-table--rank-2col bar')).toBe('rank-2col')
    expect(parseTableCustomClass('tiptap-table')).toBeNull()
    expect(parseTableCustomClass('tiptap-table--Bad')).toBeNull()
    expect(parseTableCustomClass('tiptap-table--')).toBeNull()
    expect(parseTableCustomClass(null)).toBeNull()
  })
})

describe('table customClass in the editor schema', () => {
  it('parses tiptap-table--<id> from HTML (html → tiptap format switch, paste)', () => {
    const json = generateJSON('<table class="tiptap-table tiptap-table--compact"><tbody><tr><td><p>x</p></td></tr></tbody></table>', EXT)
    expect(tableAttrs(json).customClass).toBe('compact')
  })

  it('defaults to null and ignores invalid classes', () => {
    expect(tableAttrs(generateJSON('<table><tbody><tr><td><p>x</p></td></tr></tbody></table>', EXT)).customClass).toBeNull()
    expect(
      tableAttrs(generateJSON('<table class="tiptap-table--x_y"><tbody><tr><td><p>x</p></td></tr></tbody></table>', EXT)).customClass,
    ).toBeNull()
  })

  it('renders both classes in editor HTML, and only the base class without the attr', () => {
    expect(generateHTML(doc({ customClass: 'compact' }), EXT)).toMatch(/<table[^>]*class="tiptap-table tiptap-table--compact"/)
    const plain = generateHTML(doc(), EXT)
    expect(plain).toMatch(/<table[^>]*class="tiptap-table"/)
    expect(plain).not.toContain('tiptap-table--')
  })

  it('never renders an invalid stored value (e.g. written via MCP)', () => {
    const html = generateHTML(doc({ customClass: 'x" onmouseover="1' }), EXT)
    expect(html).not.toContain('onmouseover')
    expect(html).not.toContain('tiptap-table--')
  })

  it('survives tiptap → html (runtime renderer) → tiptap', () => {
    const html = tiptapToHtml(doc({ customClass: 'compact' }))
    expect(html).toContain('class="tiptap-table tiptap-table--compact"')
    expect(tableAttrs(generateJSON(html, EXT)).customClass).toBe('compact')
  })

  it('keeps a valid id the active theme does not declare through an editor load/save', () => {
    const editor = new Editor({ extensions: EXT, content: doc({ customClass: 'retired-style' }) })
    expect(tableAttrs(editor.getJSON()).customClass).toBe('retired-style')
    editor.destroy()
  })

  it('can be set and cleared with updateAttributes while the cursor is in a cell', () => {
    const editor = new Editor({ extensions: EXT, content: doc() })
    // place the cursor inside the first cell's paragraph
    let pos = 0
    editor.state.doc.descendants((node, p) => {
      if (!pos && node.type.name === 'paragraph') pos = p + 1
    })
    editor.commands.setTextSelection(pos)
    expect(editor.isActive('table')).toBe(true)
    editor.chain().updateAttributes('table', { customClass: 'compact' }).run()
    expect(editor.getAttributes('table').customClass).toBe('compact')
    expect(tableAttrs(editor.getJSON()).customClass).toBe('compact')
    editor.chain().updateAttributes('table', { customClass: null }).run()
    expect(tableAttrs(editor.getJSON()).customClass).toBeNull()
    editor.destroy()
  })
})
