// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Post, PostMetadata, PostRevision } from 'ampless'

const routerPush = vi.hoisted(() => vi.fn())
const updatePostMock = vi.hoisted(() => vi.fn())
const createPostMock = vi.hoisted(() => vi.fn())
const getPostByIdMock = vi.hoisted(() => vi.fn())
const uploadBundleMock = vi.hoisted(() => vi.fn())
const historyProps = vi.hoisted(() => ({ onRestore: null as null | ((rev: PostRevision) => void) }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
// The history panel talks to AppSync; capture its onRestore so tests can
// drive a revision restore directly.
vi.mock('./post-history-panel.js', () => ({
  PostHistoryPanel: (props: { onRestore: (rev: PostRevision) => void }) => {
    historyProps.onRestore = props.onRestore
    return null
  },
}))
// Static uploader stand-in: a button that hands the form a pending bundle.
vi.mock('./static-uploader.js', () => ({
  StaticUploader: (props: { onFilesReady: (files: unknown[], entrypoint: string) => void }) => (
    <button type="button" id="pick-bundle" onClick={() => props.onFilesReady([{ path: 'index.html' }], 'index.html')}>
      pick
    </button>
  ),
}))
vi.mock('../lib/static-bundle.js', () => ({
  uploadBundle: uploadBundleMock,
  deleteBundle: vi.fn(),
}))
vi.mock('ampless', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ampless')>()
  return {
    ...actual,
    updatePost: updatePostMock,
    createPost: createPostMock,
    getPostById: getPostByIdMock,
  }
})

const { PostForm } = await import('./post-form.js')
const { I18nProvider } = await import('./i18n-provider.js')
const { resolveLocale } = await import('../lib/i18n.js')
const { PostUpdateConflictError, ConditionalPostUpdateUnsupportedError } = await import('ampless')
const { readDraft } = await import('../lib/post-draft.js')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const KEY = 'ampless:postClasses'
const T0 = '2026-06-01T00:00:00.000Z'
const tagged = (ids: string[]) => ({ kind: 'ampless.post-classes', version: 1, ids })
const THEME = [
  { id: 'wide', label: 'Wide' },
  { id: 'serif', label: 'Serif', description: 'Serif body' },
]
// Unrelated keys that must survive every save byte-for-byte.
const OTHER_KEYS: PostMetadata = {
  cache: 'deep',
  seo: { title: 'SEO title', noindex: true },
  postClasses: ['legacy-value'],
  files: { 'a.css': { size: 10, mimeType: 'text/css' } },
}

const makePost = (over: Partial<Post> = {}): Post => ({
  postId: 'p1',
  slug: 'weekly',
  title: 'Weekly',
  format: 'markdown',
  body: 'hello',
  status: 'draft',
  tags: [],
  updatedAt: T0,
  metadata: { ...OTHER_KEYS, [KEY]: tagged(['wide']) },
  ...over,
})

let root: Root | null = null
let container: HTMLElement | null = null

async function mount(p: Post | undefined, postClasses = THEME) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const { locale, dict } = resolveLocale('en')
  await act(async () => {
    root!.render(
      <I18nProvider locale={locale} dict={dict}>
        <PostForm post={p} postClasses={postClasses} />
      </I18nProvider>,
    )
  })
}
const checkbox = (id: string) =>
  container!.querySelector(`input[name="postClass"][value="${id}"]`) as HTMLInputElement | null
async function click(el: HTMLElement) {
  await act(async () => {
    el.click()
  })
}
async function typeTitle(value: string) {
  await act(async () => {
    const input = container!.querySelector('input#title') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() {
  await act(async () => {
    ;(container!.querySelector('form') as HTMLFormElement).requestSubmit()
  })
}
const errorText = () => container!.querySelector('p.text-destructive')?.textContent ?? null
const savedDoc = () => updatePostMock.mock.calls[0]![1] as Partial<Post>

beforeEach(() => {
  localStorage.clear()
  routerPush.mockReset()
  updatePostMock.mockReset()
  updatePostMock.mockImplementation(async (_id: string, data: Partial<Post>) => ({ ...makePost(), ...data }))
  createPostMock.mockReset()
  createPostMock.mockImplementation(async (data: Partial<Post>) => ({ ...makePost(), ...data }))
  getPostByIdMock.mockReset()
  uploadBundleMock.mockReset()
  historyProps.onRestore = null
})
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.restoreAllMocks()
})

describe('PostForm post classes', () => {
  it('lists theme classes, checks stored ones, and marks stored ids the theme does not declare', async () => {
    await mount(makePost({ metadata: { [KEY]: tagged(['wide', 'retired']) } }))
    expect(checkbox('wide')!.checked).toBe(true)
    expect(checkbox('serif')!.checked).toBe(false)
    expect(checkbox('retired')!.checked).toBe(true)
    expect(checkbox('retired')!.closest('label')!.textContent).toContain('not in current theme')
    expect(checkbox('wide')!.closest('label')!.textContent).not.toContain('not in current theme')
  })

  it('hides the group for static and no_layout HTML posts', async () => {
    await mount(makePost({ format: 'static', body: { entrypoint: 'index.html', files: ['index.html'] } }))
    expect(checkbox('wide')).toBeNull()
    await act(async () => root?.unmount())
    container?.remove()

    await mount(makePost({ format: 'html', body: '<p>x</p>', metadata: { no_layout: true, [KEY]: tagged(['wide']) } }))
    expect(checkbox('wide')).toBeNull()
  })

  it('edit save is conditional on the loaded updatedAt and keeps every metadata key verbatim when classes are unchanged', async () => {
    const metadata = { ...OTHER_KEYS, [KEY]: { ...tagged(['wide']), extra: 'kept as-is' } }
    await mount(makePost({ metadata }))
    await typeTitle('Weekly 2')
    // Toggle off and back on: same set → unchanged.
    await click(checkbox('wide')!)
    await click(checkbox('wide')!)
    await submit()

    expect(updatePostMock).toHaveBeenCalledTimes(1)
    const [id, doc, options] = updatePostMock.mock.calls[0]!
    expect(id).toBe('p1')
    expect(options).toEqual({ expected: makePost({ metadata }) })
    expect((doc as Partial<Post>).title).toBe('Weekly 2')
    expect((doc as Partial<Post>).metadata).toEqual(metadata)
    expect(routerPush).toHaveBeenCalledWith('/admin/posts')
  })

  it('writes a changed selection tagged, preserving unrelated keys (cache, SEO, legacy postClasses, files)', async () => {
    await mount(makePost())
    await click(checkbox('serif')!)
    await submit()

    expect(updatePostMock.mock.calls[0]![2]).toEqual({ expected: makePost() })
    expect(savedDoc().metadata).toEqual({ ...OTHER_KEYS, [KEY]: tagged(['wide', 'serif']) })
  })

  it('unchecking every class removes the key but keeps the others', async () => {
    await mount(makePost())
    await click(checkbox('wide')!)
    await submit()
    expect(savedDoc().metadata).toEqual(OTHER_KEYS)
    expect(savedDoc().metadata).not.toHaveProperty(KEY)
  })

  it('a new post writes the tagged value via createPost', async () => {
    await mount(undefined)
    await typeTitle('Hello')
    await click(checkbox('wide')!)
    await submit()
    expect(createPostMock).toHaveBeenCalledTimes(1)
    expect((createPostMock.mock.calls[0]![0] as Partial<Post>).metadata).toEqual({ [KEY]: tagged(['wide']) })
  })

  it('on conflict shows the message, does not navigate, and keeps the edits in the local draft', async () => {
    updatePostMock.mockRejectedValueOnce(new PostUpdateConflictError('p1', T0))
    await mount(makePost())
    await typeTitle('My unsaved title')
    await click(checkbox('serif')!)
    await submit()

    expect(errorText()).toContain('changed elsewhere')
    expect(errorText()).toContain('Nothing was saved')
    expect(routerPush).not.toHaveBeenCalled()
    const draft = readDraft('p1')
    expect(draft).not.toBeNull()
    expect(draft!.title).toBe('My unsaved title')
    expect(draft!.postClasses).toEqual(['wide', 'serif'])
    expect(draft!.baseUpdatedAt).toBe(T0)
  })

  // Legacy path: the conditional write is impossible (provider without it,
  // backend without the mutation, or no updatedAt) — the provider / core
  // throw ConditionalPostUpdateUnsupportedError without writing.
  function conditionalUnsupported() {
    updatePostMock.mockImplementation(async (_id: string, data: Partial<Post>, options?: unknown) => {
      if (options) throw new ConditionalPostUpdateUnsupportedError()
      return { ...makePost(), ...data }
    })
  }

  it('without a conditional write, a class change is refused and nothing is written', async () => {
    conditionalUnsupported()
    await mount(makePost())
    await click(checkbox('serif')!)
    await submit()
    // Only the conditional attempt (which wrote nothing) — no fallback write.
    expect(updatePostMock).toHaveBeenCalledTimes(1)
    expect(updatePostMock.mock.calls[0]).toHaveLength(3)
    expect(errorText()).toContain('Nothing was saved')
    expect(errorText()).toContain('create-ampless upgrade')
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('without a conditional write, a no_layout toggle is refused too', async () => {
    conditionalUnsupported()
    await mount(makePost({ format: 'html', body: '<p>x</p>', metadata: { ...OTHER_KEYS } }))
    await click(container!.querySelector('input[type="checkbox"]:not([name="postClass"])') as HTMLElement)
    await submit()
    expect(updatePostMock).toHaveBeenCalledTimes(1)
    expect(errorText()).toContain('Nothing was saved')
  })

  it('without a conditional write, html → markdown on a no_layout post saves WITHOUT metadata (inert stale flag stays stored)', async () => {
    conditionalUnsupported()
    const metadata = { ...OTHER_KEYS, no_layout: true }
    await mount(makePost({ format: 'html', body: '<p>x</p>', metadata }))
    await act(async () => {
      const select = container!.querySelector('select#format') as HTMLSelectElement
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(select, 'markdown')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await submit()
    expect(errorText()).toBeNull()
    expect(updatePostMock).toHaveBeenCalledTimes(2)
    // The conditional attempt would have dropped no_layout ...
    expect((updatePostMock.mock.calls[0]![1] as Partial<Post>).metadata).toEqual(OTHER_KEYS)
    // ... the legacy write leaves the stored metadata alone.
    const [, legacyDoc, options] = updatePostMock.mock.calls[1]!
    expect(options).toBeUndefined()
    expect((legacyDoc as Partial<Post>).format).toBe('markdown')
    expect((legacyDoc as Partial<Post>).metadata).toBeUndefined()
    expect(routerPush).toHaveBeenCalledWith('/admin/posts')
  })

  it('without a conditional write, turning no_layout off on an html post is refused and nothing is written', async () => {
    conditionalUnsupported()
    await mount(makePost({ format: 'html', body: '<p>x</p>', metadata: { ...OTHER_KEYS, no_layout: true } }))
    const toggle = container!.querySelector('input[type="checkbox"]:not([name="postClass"])') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    await click(toggle)
    await submit()
    expect(updatePostMock).toHaveBeenCalledTimes(1)
    expect(updatePostMock.mock.calls[0]).toHaveLength(3)
    expect(errorText()).toContain('Nothing was saved')
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('without a conditional write, restoring a markdown revision onto a no_layout html post saves WITHOUT metadata', async () => {
    conditionalUnsupported()
    await mount(makePost({ format: 'html', body: '<p>x</p>', metadata: { ...OTHER_KEYS, no_layout: true, [KEY]: tagged(['wide']) } }))
    await act(async () => {
      historyProps.onRestore!({
        postHistoryId: 'p1#old',
        postId: 'p1',
        revisedAt: '2026-05-01T00:00:00.000Z',
        title: 'Old',
        format: 'markdown',
        body: 'old',
        // Same post classes as live, so the only metadata difference is the dropped no_layout.
        metadata: { [KEY]: tagged(['wide']) },
      })
    })
    await submit()
    expect(errorText()).toBeNull()
    expect(updatePostMock).toHaveBeenCalledTimes(2)
    const legacyDoc = updatePostMock.mock.calls[1]![1] as Partial<Post>
    expect(legacyDoc.format).toBe('markdown')
    expect(legacyDoc.metadata).toBeUndefined()
  })

  it('without a conditional write, a markdown post loaded with a stale no_layout saves other edits WITHOUT metadata', async () => {
    conditionalUnsupported()
    await mount(makePost({ metadata: { ...OTHER_KEYS, no_layout: true } }))
    await typeTitle('Other edit')
    await submit()
    expect(errorText()).toBeNull()
    expect(updatePostMock).toHaveBeenCalledTimes(2)
    expect((updatePostMock.mock.calls[1]![1] as Partial<Post>).metadata).toBeUndefined()
  })

  async function selectFormat(value: string) {
    await act(async () => {
      const select = container!.querySelector('select#format') as HTMLSelectElement
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(select, value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
  const noLayoutToggle = () =>
    container!.querySelector('input[type="checkbox"]:not([name="postClass"])') as HTMLInputElement | null

  async function remount(p: Post) {
    await act(async () => root?.unmount())
    container?.remove()
    routerPush.mockReset()
    await mount(p)
  }

  it('legacy: html no_layout post -> markdown -> re-opened -> html is not reactivated, and the save is refused', async () => {
    conditionalUnsupported()
    const metadata = { ...OTHER_KEYS, no_layout: true }
    await mount(makePost({ format: 'html', body: '<p>x</p>', metadata }))
    await selectFormat('markdown')
    await submit()
    expect(errorText()).toBeNull()
    expect((updatePostMock.mock.calls[1]![1] as Partial<Post>).metadata).toBeUndefined()

    // The stored row: markdown, metadata still carries the inert flag.
    updatePostMock.mockClear()
    await remount(makePost({ format: 'markdown', body: 'x', metadata }))
    await selectFormat('html')
    expect(noLayoutToggle()!.checked).toBe(false)
    await submit()
    expect(updatePostMock).toHaveBeenCalledTimes(1)
    expect(updatePostMock.mock.calls[0]).toHaveLength(3)
    expect(errorText()).toContain('Nothing was saved')
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('conditional: the same sequence clears no_layout and keeps every other key', async () => {
    const metadata = { ...OTHER_KEYS, no_layout: true }
    await mount(makePost({ format: 'markdown', body: 'x', metadata }))
    await selectFormat('html')
    expect(noLayoutToggle()!.checked).toBe(false)
    await submit()
    expect(errorText()).toBeNull()
    expect(updatePostMock).toHaveBeenCalledTimes(1)
    const doc = savedDoc()
    expect(doc.format).toBe('html')
    expect(doc.metadata).toEqual(OTHER_KEYS)
    expect(doc.metadata).not.toHaveProperty('no_layout')
  })

  it('a re-opened markdown post with an inert no_layout has no draft artefact, and an old draft cannot enable it', async () => {
    const stored = makePost({ metadata: { ...OTHER_KEYS, no_layout: true } })
    const oldDraft = (title: string) =>
      JSON.stringify({
        title, slug: 'weekly', excerpt: '', format: 'markdown', body: 'hello', status: 'draft',
        tags: '', publishedAtInput: '', noLayout: true, baseUpdatedAt: T0, savedAt: Date.now(),
      })
    await mount(stored)
    expect(container!.querySelector('[role="alert"]')).toBeNull()
    expect(readDraft('p1')).toBeNull()
    await act(async () => root?.unmount())
    container?.remove()

    // Old draft identical to the stored post except for the stale flag: dropped silently.
    localStorage.setItem('ampless:draft:p1', oldDraft('Weekly'))
    await mount(stored)
    expect(container!.querySelector('[role="alert"]')).toBeNull()
    expect(readDraft('p1')).toBeNull()
    await act(async () => root?.unmount())
    container?.remove()

    // Old draft with a real edit: restoring keeps no_layout off after switching to html.
    localStorage.setItem('ampless:draft:p1', oldDraft('Edited'))
    await mount(stored)
    const restore = Array.from(container!.querySelectorAll('button')).find((b) => b.textContent === 'Restore')
    await click(restore!)
    await selectFormat('html')
    expect(noLayoutToggle()!.checked).toBe(false)
  })

  it('without a conditional write, other edits are saved WITHOUT the metadata field (stored metadata untouched)', async () => {
    conditionalUnsupported()
    await mount(makePost())
    await typeTitle('Other edit')
    await submit()
    expect(updatePostMock).toHaveBeenCalledTimes(2)
    const [id, legacyDoc, options] = updatePostMock.mock.calls[1]!
    expect(id).toBe('p1')
    expect(options).toBeUndefined()
    expect((legacyDoc as Partial<Post>).title).toBe('Other edit')
    expect((legacyDoc as Partial<Post>).metadata).toBeUndefined()
    expect(routerPush).toHaveBeenCalledWith('/admin/posts')
  })

  it('without a known updatedAt (provider refuses), a class change is refused and other edits keep the legacy save', async () => {
    updatePostMock.mockImplementation(async (_id: string, data: Partial<Post>, options?: { expected: Post }) => {
      if (options && !options.expected.updatedAt) throw new ConditionalPostUpdateUnsupportedError()
      return { ...makePost(), ...data }
    })
    await mount(makePost({ updatedAt: undefined }))
    await click(checkbox('serif')!)
    await submit()
    expect(updatePostMock).toHaveBeenCalledTimes(1)
    expect(errorText()).toContain('Nothing was saved')
    await click(checkbox('serif')!) // back to the loaded selection
    await typeTitle('Other edit')
    await submit()
    expect(updatePostMock).toHaveBeenCalledTimes(3)
    expect(updatePostMock.mock.calls[2]![2]).toBeUndefined()
    expect((updatePostMock.mock.calls[2]![1] as Partial<Post>).metadata).toBeUndefined()
  })

  it('a foreign value under the key disables editing and survives the save untouched', async () => {
    const metadata = { ...OTHER_KEYS, [KEY]: ['wide'] }
    await mount(makePost({ metadata }))
    expect(checkbox('wide')).toBeNull()
    expect(container!.textContent).toContain('that ampless did not write')
    await typeTitle('Edited')
    await submit()
    expect(savedDoc().metadata).toEqual(metadata)
  })

  it('restore applies the revision classes but keeps the live metadata keys', async () => {
    await mount(makePost())
    expect(historyProps.onRestore).toBeTypeOf('function')
    await act(async () => {
      historyProps.onRestore!({
        postHistoryId: 'p1#old',
        postId: 'p1',
        revisedAt: '2026-05-01T00:00:00.000Z',
        title: 'Old title',
        slug: 'weekly',
        format: 'markdown',
        body: 'old body',
        status: 'draft',
        tags: [],
        metadata: { cache: 'hot', seo: { title: 'old seo' }, [KEY]: tagged(['serif']) },
      })
    })
    expect(checkbox('serif')!.checked).toBe(true)
    expect(checkbox('wide')!.checked).toBe(false)
    await submit()
    expect(savedDoc().title).toBe('Old title')
    expect(savedDoc().metadata).toEqual({ ...OTHER_KEYS, [KEY]: tagged(['serif']) })
  })

  it('restore does not touch a live foreign value', async () => {
    const metadata = { ...OTHER_KEYS, [KEY]: 'theirs' }
    await mount(makePost({ metadata }))
    await act(async () => {
      historyProps.onRestore!({
        postHistoryId: 'p1#old',
        postId: 'p1',
        revisedAt: '2026-05-01T00:00:00.000Z',
        title: 'Old',
        format: 'markdown',
        body: 'b',
        metadata: { [KEY]: tagged(['serif']) },
      })
    })
    await submit()
    expect(savedDoc().metadata).toEqual(metadata)
  })
})

describe('PostForm preview request', () => {
  async function previewRequestBody(p: Post): Promise<Record<string, unknown>> {
    const fetchMock = vi.fn(async () => new Response('<!doctype html><html><head></head><body></body></html>'))
    vi.stubGlobal('fetch', fetchMock)
    await mount(p)
    const previewTab = [...container!.querySelectorAll('button')].find((b) => b.textContent === 'Preview')!
    await click(previewTab)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300))
    })
    vi.unstubAllGlobals()
    expect(fetchMock).toHaveBeenCalled()
    const init = (fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1]
    return JSON.parse(init.body as string) as Record<string, unknown>
  }

  it('sends only the tagged post-classes key from the current selection', async () => {
    const body = await previewRequestBody(makePost())
    expect(body.metadata).toEqual({ [KEY]: tagged(['wide']) })
  })

  it('sends no metadata at all without classes (same request as before post classes)', async () => {
    const body = await previewRequestBody(makePost({ metadata: { ...OTHER_KEYS } }))
    expect(body).not.toHaveProperty('metadata')
  })
})

// A new-bundle static save is NOT safe against concurrent changes (#411
// requirement 4 is not addressed; it needs a separately reviewed design).
// These tests pin only the best-effort pre-check and the unchanged
// unconditional write.
describe('PostForm static saves (bundle replace not concurrency-safe; pre-check only)', () => {
  const staticPost = () =>
    makePost({
      format: 'static',
      body: { entrypoint: 'index.html', files: ['index.html'] },
      metadata: { ...OTHER_KEYS },
    })

  it('with a pending bundle, aborts before uploadBundle when the post changed since load', async () => {
    getPostByIdMock.mockResolvedValueOnce({ ...staticPost(), updatedAt: '2026-06-02T00:00:00.000Z' })
    await mount(staticPost())
    await click(container!.querySelector('#pick-bundle') as HTMLElement)
    await submit()
    expect(getPostByIdMock).toHaveBeenCalledWith('p1')
    expect(uploadBundleMock).not.toHaveBeenCalled()
    expect(updatePostMock).not.toHaveBeenCalled()
    expect(errorText()).toContain('no bundle was uploaded')
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('with a pending bundle and no change, uploads then keeps the unconditional write', async () => {
    getPostByIdMock.mockResolvedValueOnce(staticPost())
    uploadBundleMock.mockResolvedValueOnce({
      body: { entrypoint: 'index.html', files: ['index.html'] },
      filesMeta: { 'index.html': { size: 1, mimeType: 'text/html' } },
    })
    await mount(staticPost())
    await click(container!.querySelector('#pick-bundle') as HTMLElement)
    await submit()
    expect(uploadBundleMock).toHaveBeenCalledTimes(1)
    expect(getPostByIdMock.mock.invocationCallOrder[0]!).toBeLessThan(uploadBundleMock.mock.invocationCallOrder[0]!)
    expect(updatePostMock).toHaveBeenCalledTimes(1)
    expect(updatePostMock.mock.calls[0]).toHaveLength(2)
  })

  it('without a new bundle, uses the conditional update like other formats', async () => {
    await mount(staticPost())
    await typeTitle('Renamed')
    await submit()
    expect(getPostByIdMock).not.toHaveBeenCalled()
    expect(uploadBundleMock).not.toHaveBeenCalled()
    expect(updatePostMock.mock.calls[0]![2]).toEqual({ expected: staticPost() })
    expect(savedDoc().metadata).toEqual(OTHER_KEYS)
  })
})
