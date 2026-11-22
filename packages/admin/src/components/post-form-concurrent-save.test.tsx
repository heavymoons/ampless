// @vitest-environment jsdom

// Real interleavings of a PostForm save with a concurrent write (e.g. MCP
// `update_post`). Unlike post-form-post-classes.test.tsx, `ampless` is NOT
// mocked: the form goes through the real core `getPostById` /
// `updatePost` / `mergePostMetadata`, backed by an in-memory provider
// registered with `setPostsProvider`. The provider does a true
// compare-and-swap on `updatedAt`, bumping it on every write.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Post, PostsProvider, UpdatePostOptions } from 'ampless'

const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
// The history panel talks to AppSync; it plays no part here.
vi.mock('./post-history-panel.js', () => ({ PostHistoryPanel: () => null }))

const { setPostsProvider, PostUpdateConflictError } = await import('ampless')
const { PostForm } = await import('./post-form.js')
const { I18nProvider } = await import('./i18n-provider.js')
const { resolveLocale } = await import('../lib/i18n.js')
type EditorPostClass = import('./post-classes-field.js').EditorPostClass

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CLASSES: EditorPostClass[] = [
  { id: 'a', label: 'Style A' },
  { id: 'b', label: 'Style B' },
  { id: 'c', label: 'Style C' },
]

const CONFLICT_MESSAGE = 'This post was changed elsewhere while saving. Your edits are kept — save again to retry.'
const UNSUPPORTED_MESSAGE =
  'The configured posts provider cannot save this post safely. It must implement conditional updates (supportsConditionalUpdate) so that a concurrent change is not overwritten. Nothing was saved.'

const clone = <T,>(v: T): T => structuredClone(v)

// One-row in-memory store with compare-and-swap semantics.
function makeStore(initial: Post, { conditional }: { conditional: boolean }) {
  let row: Post = clone(initial)
  let clock = 0
  const bump = () => new Date(Date.UTC(2026, 5, 10, 0, 0, ++clock)).toISOString()
  // Runs once, right after the next getById took its snapshot and before it
  // resolves — i.e. between the form's re-read and its write.
  let afterNextGetById: (() => void) | null = null

  function apply(patch: Partial<Post>) {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    row = { ...row, ...clone(defined), updatedAt: bump() }
  }

  const update = vi.fn(async (postId: string, data: Partial<Post>, options?: UpdatePostOptions) => {
    if (postId !== row.postId) throw new Error(`no post ${postId}`)
    if (conditional && options?.expectedUpdatedAt !== undefined) {
      if ((row.updatedAt ?? null) !== options.expectedUpdatedAt) throw new PostUpdateConflictError()
    }
    // A legacy provider would ignore `options` and write unconditionally.
    apply(data)
    return clone(row)
  })
  const getById = vi.fn(async (postId: string) => {
    const snapshot = postId === row.postId ? clone(row) : null
    const hook = afterNextGetById
    afterNextGetById = null
    hook?.()
    return snapshot
  })
  const notImpl = async (): Promise<never> => {
    throw new Error('not used in this test')
  }
  const provider: PostsProvider = {
    ...(conditional ? { supportsConditionalUpdate: true } : {}),
    list: async () => [clone(row)],
    get: async (slug) => (slug === row.slug ? clone(row) : null),
    getById,
    create: notImpl,
    update,
    remove: notImpl,
    listPostHistory: async () => ({ items: [] }),
  }
  return {
    provider,
    update,
    getById,
    get row() {
      return clone(row)
    },
    /** A concurrent writer (MCP update_post) replacing metadata. */
    concurrentWrite(patch: Partial<Post>) {
      apply(patch)
    },
    onNextGetById(fn: () => void) {
      afterNextGetById = fn
    },
  }
}

const initialPost = (): Post => ({
  postId: 'p1',
  slug: 'weekly',
  title: 'Weekly',
  format: 'markdown',
  body: 'hello',
  status: 'draft',
  tags: [],
  updatedAt: '2026-06-01T00:00:00.000Z',
  metadata: { postClasses: ['a'], plugin_x: { n: 1 }, seo: { title: 'S' } },
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
        <PostForm post={p} availablePostClasses={CLASSES} />
      </I18nProvider>,
    )
  })
}

async function click(el: Element) {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}
const checkboxByLabel = (text: string) => {
  const label = Array.from(container!.querySelectorAll('label')).find((l) => l.textContent?.includes(text))
  return label!.querySelector('input[type="checkbox"]') as HTMLInputElement
}
async function typeTitle(value: string) {
  const input = container!.querySelector('#title') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() {
  await act(async () => {
    container!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}
const errorText = () => container!.querySelector('p.text-destructive')?.textContent ?? null
const titleValue = () => (container!.querySelector('#title') as HTMLInputElement).value

beforeEach(() => {
  localStorage.clear()
  routerPush.mockClear()
})
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  // @ts-expect-error — clear the module-level provider for isolation.
  setPostsProvider(null)
  vi.restoreAllMocks()
})

describe('PostForm save racing a concurrent write (real core, in-memory CAS provider)', () => {
  it('a write landing before the re-read is merged: postClasses unioned, other plugin keys kept', async () => {
    const store = makeStore(initialPost(), { conditional: true })
    setPostsProvider(store.provider)
    await mount(store.row)

    // MCP update_post: ['a'] -> ['a', 'b'] after the form loaded.
    store.concurrentWrite({ metadata: { ...store.row.metadata, postClasses: ['a', 'b'] } })
    const afterMcp = store.row.updatedAt
    // The user adds 'c' and edits the title.
    await click(checkboxByLabel('Style C'))
    await typeTitle('Weekly 2')
    await submit()

    expect(errorText()).toBeNull()
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(store.update.mock.calls[0]![2]).toEqual({ expectedUpdatedAt: afterMcp })
    expect(store.row.title).toBe('Weekly 2')
    expect(store.row.metadata).toEqual({ postClasses: ['a', 'b', 'c'], plugin_x: { n: 1 }, seo: { title: 'S' } })
    expect(routerPush).toHaveBeenCalledWith('/admin/posts')
  })

  it('a write landing between the re-read and the write is a conflict; saving again merges', async () => {
    const store = makeStore(initialPost(), { conditional: true })
    setPostsProvider(store.provider)
    await mount(store.row)

    await click(checkboxByLabel('Style C'))
    await typeTitle('Weekly 2')
    store.onNextGetById(() => {
      store.concurrentWrite({
        metadata: { ...store.row.metadata, postClasses: ['a', 'b'], plugin_x: { n: 2 } },
      })
    })
    await submit()

    expect(errorText()).toBe(CONFLICT_MESSAGE)
    expect(store.update).toHaveBeenCalledTimes(1) // attempted, rejected by the CAS
    // The concurrent write survives and the form's edit was not persisted.
    expect(store.row.title).toBe('Weekly')
    expect(store.row.metadata).toEqual({ postClasses: ['a', 'b'], plugin_x: { n: 2 }, seo: { title: 'S' } })
    expect(routerPush).not.toHaveBeenCalled()
    // The form keeps its state.
    expect(titleValue()).toBe('Weekly 2')
    expect(checkboxByLabel('Style C').checked).toBe(true)

    await submit()

    expect(errorText()).toBeNull()
    expect(store.getById).toHaveBeenCalledTimes(2)
    expect(store.row.title).toBe('Weekly 2')
    expect(store.row.metadata).toEqual({ postClasses: ['a', 'b', 'c'], plugin_x: { n: 2 }, seo: { title: 'S' } })
    expect(routerPush).toHaveBeenCalledWith('/admin/posts')
  })

  it('a provider without supportsConditionalUpdate is refused: nothing written, the concurrent write survives', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = makeStore(initialPost(), { conditional: false })
    setPostsProvider(store.provider)
    await mount(store.row)

    await click(checkboxByLabel('Style C'))
    await typeTitle('Weekly 2')
    store.onNextGetById(() => {
      store.concurrentWrite({ metadata: { ...store.row.metadata, postClasses: ['a', 'b'] } })
    })
    await submit()

    expect(errorText()).toBe(UNSUPPORTED_MESSAGE)
    expect(store.update).not.toHaveBeenCalled()
    expect(store.row.title).toBe('Weekly')
    expect(store.row.metadata).toEqual({ postClasses: ['a', 'b'], plugin_x: { n: 1 }, seo: { title: 'S' } })
    expect(routerPush).not.toHaveBeenCalled()
    expect(titleValue()).toBe('Weekly 2')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('a key changed on both sides is a conflict: no write, and the error names the key', async () => {
    // The form edits no plugin keys itself (it keeps them as loaded), so the
    // key both sides change here is the form-owned `no_layout`; a plugin
    // key changed only elsewhere still merges cleanly.
    const html: Post = {
      ...initialPost(),
      format: 'html',
      body: '<p>x</p>',
      metadata: { no_layout: true, plugin_x: { n: 1 } },
    }
    const store = makeStore(html, { conditional: true })
    setPostsProvider(store.provider)
    await mount(store.row)

    // Elsewhere: no_layout true -> false, and plugin_x changed.
    store.concurrentWrite({ metadata: { no_layout: false as unknown as true, plugin_x: { n: 2 } } })
    const before = store.row
    // Here: no_layout true -> removed, and a title edit.
    await click(checkboxByLabel('No layout'))
    await typeTitle('Weekly 2')
    await submit()

    expect(store.update).not.toHaveBeenCalled()
    expect(store.row).toEqual(before)
    expect(errorText()).toBe(
      'These settings were changed elsewhere while you edited them: no_layout. Nothing was saved — reload the post to see the other change.',
    )
    expect(titleValue()).toBe('Weekly 2')
    expect(routerPush).not.toHaveBeenCalled()
  })
})
