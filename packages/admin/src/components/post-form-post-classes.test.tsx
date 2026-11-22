// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Post } from 'ampless'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
// The history panel talks to AppSync; capture its onRestore so a test can
// feed a revision into the form.
let restoreRevision: ((rev: unknown) => void) | null = null
vi.mock('./post-history-panel.js', () => ({
  PostHistoryPanel: ({ onRestore }: { onRestore: (rev: unknown) => void }) => {
    restoreRevision = onRestore
    return null
  },
}))
// Capture the save payload instead of talking to AppSync.
const updatePost = vi.fn(async () => undefined)
const createPost = vi.fn(async () => undefined)
vi.mock('ampless', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ampless')>()),
  updatePost: (...args: unknown[]) => updatePost(...(args as [])),
  createPost: (...args: unknown[]) => createPost(...(args as [])),
}))

const { PostForm } = await import('./post-form.js')
const { I18nProvider } = await import('./i18n-provider.js')
const { resolveLocale } = await import('../lib/i18n.js')
type EditorPostClass = import('./post-classes-field.js').EditorPostClass

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const THEME: EditorPostClass[] = [
  { id: 'wide', label: 'Wide', description: 'Full-width body' },
  { id: 'serif', label: 'Serif' },
]

const post = (metadata?: Post['metadata']): Post => ({
  postId: 'p1',
  slug: 'weekly',
  title: 'Weekly',
  format: 'markdown',
  body: 'hello',
  status: 'draft',
  tags: [],
  metadata,
})

let root: Root | null = null
let container: HTMLElement | null = null

async function mount(p: Post | undefined, available?: EditorPostClass[]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const { locale, dict } = resolveLocale('en')
  await act(async () => {
    root!.render(
      <I18nProvider locale={locale} dict={dict}>
        <PostForm post={p} availablePostClasses={available} />
      </I18nProvider>,
    )
  })
}

const fieldset = () =>
  Array.from(container!.querySelectorAll('fieldset')).find((f) =>
    f.querySelector('legend')?.textContent?.includes('Post styles'),
  ) ?? null
const checkbox = (label: string) => {
  const l = Array.from(fieldset()!.querySelectorAll('label')).find((x) => x.textContent?.includes(label))
  return l!.querySelector('input[type="checkbox"]') as HTMLInputElement
}
const undeclaredRows = () => Array.from(container!.querySelectorAll('[data-testid="post-class-undeclared"]'))
async function click(el: Element) {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}
async function submit() {
  await act(async () => {
    container!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}
const savedMetadata = () => (updatePost.mock.calls.at(-1) as unknown as [string, { metadata: unknown }])[1].metadata

beforeEach(() => {
  localStorage.clear()
  updatePost.mockClear()
  createPost.mockClear()
  restoreRevision = null
})
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PostForm post styles', () => {
  it('is hidden when the theme declares none and the post has none', async () => {
    await mount(post({ cache: 'deep' }))
    expect(fieldset()).toBeNull()
  })

  it('is hidden for no_layout html posts but keeps the stored classes on save', async () => {
    await mount({ ...post({ no_layout: true, postClasses: ['wide'] }), format: 'html', body: '<p>x</p>' }, THEME)
    expect(fieldset()).toBeNull()
    await submit()
    expect(savedMetadata()).toEqual({ no_layout: true, postClasses: ['wide'] })
  })

  it('offers declared classes as checkboxes with label and description', async () => {
    await mount(post({ postClasses: ['serif'] }), THEME)
    expect(fieldset()!.textContent).toContain('Full-width body')
    expect(checkbox('Wide').checked).toBe(false)
    expect(checkbox('Serif').checked).toBe(true)
    expect(undeclaredRows()).toHaveLength(0)
  })

  it('toggling a class saves postClasses and keeps other metadata keys', async () => {
    await mount(post({ cache: 'deep', seo: { title: 'X' }, postClasses: ['serif'] }), THEME)
    await click(checkbox('Wide'))
    await submit()
    expect(savedMetadata()).toEqual({ cache: 'deep', seo: { title: 'X' }, postClasses: ['serif', 'wide'] })

    await click(checkbox('Serif'))
    await click(checkbox('Wide'))
    await submit()
    // Unchecking everything removes the key; unrelated keys stay.
    expect(savedMetadata()).toEqual({ cache: 'deep', seo: { title: 'X' } })
  })

  it('flags stored ids the theme does not declare, keeps them on save, and removes them on request', async () => {
    await mount(post({ cache: 'hot', plugin_x: 1, postClasses: ['legacy', 'wide'] }), THEME)
    const rows = undeclaredRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain('legacy (not declared by the active theme)')
    expect(checkbox('Wide').checked).toBe(true)

    await submit()
    expect(savedMetadata()).toEqual({ cache: 'hot', plugin_x: 1, postClasses: ['legacy', 'wide'] })

    await click(rows[0]!.querySelector('button')!)
    expect(undeclaredRows()).toHaveLength(0)
    await submit()
    expect(savedMetadata()).toEqual({ cache: 'hot', plugin_x: 1, postClasses: ['wide'] })
  })

  it('shows stored ids with a hint when the theme declares no post styles', async () => {
    await mount(post({ postClasses: ['legacy', 'Bad Id'] }))
    expect(fieldset()!.textContent).toContain('The active theme declares no post styles.')
    // Invalid ids never render, so they are not carried forward.
    expect(undeclaredRows().map((r) => r.textContent)).toEqual([
      expect.stringContaining('legacy (not declared by the active theme)'),
    ])
  })

  it('a new post saves the selected classes via createPost', async () => {
    await mount(undefined, THEME)
    await click(checkbox('Serif'))
    await submit()
    const input = (createPost.mock.calls.at(-1) as unknown as [{ metadata: unknown }])[0]
    expect(input.metadata).toEqual({ postClasses: ['serif'] })
  })

  it('autosave drafts carry postClasses', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await mount(post({ postClasses: ['serif'] }), THEME)
    await click(checkbox('Wide'))
    await act(async () => {
      vi.advanceTimersByTime(1300)
    })
    const draft = JSON.parse(localStorage.getItem('ampless:draft:p1') ?? 'null')
    expect(draft.postClasses).toEqual(['serif', 'wide'])
  })

  it('the preview request sends the edited post classes in metadata', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fetchMock = vi.fn(async () => new Response('<p>ok</p>'))
    vi.stubGlobal('fetch', fetchMock)
    await mount(post({ cache: 'deep' }), THEME)
    await click(checkbox('Wide'))
    const previewTab = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Preview')!
    await click(previewTab)
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(fetchMock).toHaveBeenCalled()
    const init = (fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1]
    expect(JSON.parse(init.body as string).metadata).toEqual({ cache: 'deep', postClasses: ['wide'] })
    vi.unstubAllGlobals()
  })

  it('restoring a revision applies its postClasses (none when the revision has none)', async () => {
    await mount(post({ cache: 'deep', postClasses: ['wide'] }), THEME)
    await act(async () => {
      restoreRevision!({ title: 'Old', slug: 'weekly', format: 'markdown', body: 'old', metadata: { postClasses: ['serif'] } })
    })
    expect(checkbox('Serif').checked).toBe(true)
    expect(checkbox('Wide').checked).toBe(false)
    await act(async () => {
      restoreRevision!({ title: 'Older', slug: 'weekly', format: 'markdown', body: 'older', metadata: { cache: 'hot' } })
    })
    expect(checkbox('Serif').checked).toBe(false)
    await submit()
    // Other keys still come from the live post, not the revision.
    expect(savedMetadata()).toEqual({ cache: 'deep' })
  })

  it('recovering a draft restores its postClasses; a draft without the field keeps the loaded ones', async () => {
    const base = { title: 'Weekly', slug: 'weekly', excerpt: '', format: 'markdown', status: 'draft', tags: '' }
    const recover = async () => {
      const btn = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Restore')
      await click(btn!)
    }
    localStorage.setItem(
      'ampless:draft:p1',
      JSON.stringify({ ...base, body: 'edited', publishedAtInput: '', noLayout: false, postClasses: ['serif'], baseUpdatedAt: null, savedAt: 1 }),
    )
    await mount(post({ postClasses: ['wide'] }), THEME)
    await recover()
    expect(checkbox('Serif').checked).toBe(true)
    expect(checkbox('Wide').checked).toBe(false)
    await act(async () => root?.unmount())
    container?.remove()

    localStorage.setItem(
      'ampless:draft:p1',
      JSON.stringify({ ...base, body: 'edited', publishedAtInput: '', noLayout: false, baseUpdatedAt: null, savedAt: 1 }),
    )
    await mount(post({ postClasses: ['wide'] }), THEME)
    await recover()
    expect(checkbox('Wide').checked).toBe(true)
    expect(checkbox('Serif').checked).toBe(false)
  })
})
