import { describe, it, expect, vi } from 'vitest'
import { tiptapToHtml } from '@ampless/runtime'
import { tableClassesLostOnConversion, confirmLossyFormatChange } from './format-switch.js'
import en from '../locales/en.json'
import ja from '../locales/ja.json'

const table = (customClass?: unknown) => ({
  type: 'table',
  ...(customClass !== undefined ? { attrs: { customClass } } : {}),
  content: [
    {
      type: 'tableRow',
      content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }],
    },
  ],
})
const doc = (...tables: unknown[]) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'intro' }] }, ...tables],
})

describe('tableClassesLostOnConversion', () => {
  it('lists table classes a tiptap → markdown conversion would drop (de-duplicated, in order)', () => {
    const body = doc(table('compact'), table(), table('striped'), table('compact'))
    expect(tableClassesLostOnConversion(body, 'tiptap', 'markdown')).toEqual(['compact', 'striped'])
  })

  it('finds classes in nested content (e.g. a table inside a blockquote)', () => {
    const body = { type: 'doc', content: [{ type: 'blockquote', content: [table('compact')] }] }
    expect(tableClassesLostOnConversion(body, 'tiptap', 'markdown')).toEqual(['compact'])
  })

  it('lists classes for html → markdown, using the HTML the runtime renders', () => {
    const html = tiptapToHtml(doc(table('compact'), table()))
    expect(html).toContain('tiptap-table--compact')
    expect(tableClassesLostOnConversion(html, 'html', 'markdown')).toEqual(['compact'])
    expect(
      tableClassesLostOnConversion("<table class='x tiptap-table--rank-2col'><tr><td>1</td></tr></table>", 'html', 'markdown'),
    ).toEqual(['rank-2col'])
  })

  it('scans a tiptap body that is still an HTML string (right after a switch to tiptap)', () => {
    const html = tiptapToHtml(doc(table('compact')))
    expect(tableClassesLostOnConversion(html, 'tiptap', 'markdown')).toEqual(['compact'])
  })

  it('returns [] for tables without classes, invalid ids and non-table classes', () => {
    expect(tableClassesLostOnConversion(doc(table(), table(null), table('Bad Id'), table('x"y')), 'tiptap', 'markdown')).toEqual([])
    expect(tableClassesLostOnConversion(tiptapToHtml(doc(table())), 'html', 'markdown')).toEqual([])
    expect(tableClassesLostOnConversion('<div class="tiptap-table--compact"></div>', 'html', 'markdown')).toEqual([])
    expect(tableClassesLostOnConversion('<table class="tiptap-table--Bad"></table>', 'html', 'markdown')).toEqual([])
  })

  it('returns [] for lossless conversions', () => {
    const body = doc(table('compact'))
    const html = tiptapToHtml(body)
    expect(tableClassesLostOnConversion(body, 'tiptap', 'html')).toEqual([])
    expect(tableClassesLostOnConversion(html, 'html', 'tiptap')).toEqual([])
    expect(tableClassesLostOnConversion('| a |\n| - |\n| 1 |', 'markdown', 'tiptap')).toEqual([])
    expect(tableClassesLostOnConversion('| a |', 'markdown', 'html')).toEqual([])
    expect(tableClassesLostOnConversion(body, 'tiptap', 'static')).toEqual([])
  })
})

describe('confirmLossyFormatChange', () => {
  const message = (classes: string[]) => `lose: ${classes.join(', ')}`

  it('asks with the affected classes and stops when the editor cancels', () => {
    const confirm = vi.fn(() => false)
    expect(confirmLossyFormatChange(doc(table('compact'), table('striped')), 'tiptap', 'markdown', confirm, message)).toBe(false)
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenCalledWith('lose: compact, striped')
  })

  it('proceeds when the editor confirms (html input)', () => {
    const confirm = vi.fn(() => true)
    expect(confirmLossyFormatChange(tiptapToHtml(doc(table('compact'))), 'html', 'markdown', confirm, message)).toBe(true)
    expect(confirm).toHaveBeenCalledWith('lose: compact')
  })

  it('does not prompt for unaffected tables or lossless targets', () => {
    const confirm = vi.fn(() => false)
    expect(confirmLossyFormatChange(doc(table()), 'tiptap', 'markdown', confirm, message)).toBe(true)
    expect(confirmLossyFormatChange(doc(table('compact')), 'tiptap', 'html', confirm, message)).toBe(true)
    expect(confirmLossyFormatChange(tiptapToHtml(doc(table())), 'html', 'markdown', confirm, message)).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('format loss message', () => {
  it('exists in both locales and names the classes placeholder', () => {
    const get = (d: unknown) => (d as { posts: { form: Record<string, string> } }).posts.form.formatLossTableClasses
    expect(get(en)).toContain('{classes}')
    expect(get(ja)).toContain('{classes}')
  })
})
