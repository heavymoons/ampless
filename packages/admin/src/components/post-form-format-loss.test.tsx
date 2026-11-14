// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Post } from 'ampless'
import { tiptapToHtml } from '@ampless/runtime'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
// The history panel talks to AppSync; it is irrelevant to the format switch.
vi.mock('./post-history-panel.js', () => ({ PostHistoryPanel: () => null }))

const { PostForm } = await import('./post-form.js')
const { I18nProvider } = await import('./i18n-provider.js')
const { resolveLocale } = await import('../lib/i18n.js')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const tableDoc = (customClass?: string) => ({
  type: 'doc',
  content: [
    {
      type: 'table',
      ...(customClass ? { attrs: { customClass } } : {}),
      content: [
        {
          type: 'tableRow',
          content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rank' }] }] }],
        },
        {
          type: 'tableRow',
          content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] }],
        },
      ],
    },
  ],
})

const post = (format: Post['format'], body: unknown): Post => ({
  postId: 'p1',
  slug: 'weekly',
  title: 'Weekly',
  format,
  body,
  status: 'draft',
  tags: [],
})

let root: Root | null = null
let container: HTMLElement | null = null

async function mount(p: Post) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const { locale, dict } = resolveLocale('en')
  await act(async () => {
    root!.render(
      <I18nProvider locale={locale} dict={dict}>
        <PostForm post={p} />
      </I18nProvider>,
    )
  })
}
const select = () => container!.querySelector('select#format') as HTMLSelectElement
async function chooseFormat(value: string) {
  await act(async () => {
    const s = select()
    s.value = value
    s.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
// The body textarea (markdown / html); `#excerpt` is the other textarea.
const bodyTextarea = () => container!.querySelector('textarea:not(#excerpt)') as HTMLTextAreaElement | null

beforeEach(() => {
  localStorage.clear()
})
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.restoreAllMocks()
})

describe('PostForm format switch with table styles', () => {
  it('html → markdown: asks, and Cancel keeps the html format and body untouched', async () => {
    const html = tiptapToHtml(tableDoc('compact'))
    await mount(post('html', html))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await chooseFormat('markdown')
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0]![0]).toContain('compact')
    expect(confirm.mock.calls[0]![0]).toContain('Markdown cannot keep table styles')
    expect(select().value).toBe('html')
    expect(bodyTextarea()!.value).toBe(html)
  })

  it('html → markdown: OK converts (the class is gone, as confirmed)', async () => {
    await mount(post('html', tiptapToHtml(tableDoc('compact'))))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await chooseFormat('markdown')
    expect(select().value).toBe('markdown')
    expect(bodyTextarea()!.value).toContain('Rank')
    expect(bodyTextarea()!.value).not.toContain('compact')
  })

  it('tiptap → markdown: asks for a styled table and Cancel keeps tiptap', async () => {
    await mount(post('tiptap', tableDoc('compact')))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await chooseFormat('markdown')
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0]![0]).toContain('compact')
    expect(select().value).toBe('tiptap')
  })

  it('does not ask for unstyled tables or for lossless switches', async () => {
    await mount(post('tiptap', tableDoc()))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await chooseFormat('markdown')
    expect(confirm).not.toHaveBeenCalled()
    expect(select().value).toBe('markdown')
  })

  it('does not ask when a styled table goes tiptap → html (the class is kept)', async () => {
    await mount(post('tiptap', tableDoc('compact')))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await chooseFormat('html')
    expect(confirm).not.toHaveBeenCalled()
    expect(select().value).toBe('html')
    expect(bodyTextarea()!.value).toContain('tiptap-table--compact')
  })
})
