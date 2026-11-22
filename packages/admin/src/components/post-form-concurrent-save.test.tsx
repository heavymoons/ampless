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
// The history panel talks to AppSync; the stub only hands out its
// `onRestore` so a test can restore a revision.
let restoreRevision: ((rev: unknown) => void) | null = null
vi.mock('./post-history-panel.js', () => ({
  PostHistoryPanel: ({ onRestore }: { onRestore: (rev: unknown) => void }) => {
    restoreRevision = onRestore
    return null
  },
}))
// In-memory S3 behind `aws-amplify/storage`: the real
// `lib/static-bundle.js` (upload / delete helpers) and the real
// StaticUploader run on top of it. Keys map to their bytes.
const s3 = new Map<string, Uint8Array>()
const s3Uploads: string[] = []
const s3Removes: string[] = []
vi.mock('aws-amplify/storage', () => ({
  uploadData: ({ path, data }: { path: string; data: Uint8Array }) => ({
    result: (async () => {
      s3Uploads.push(path)
      s3.set(path, new Uint8Array(data))
      return { path }
    })(),
  }),
  list: async ({ path }: { path: string }) => ({
    items: [...s3.keys()].filter((k) => k.startsWith(path)).map((k) => ({ path: k })),
  }),
  remove: async ({ path }: { path: string }) => {
    s3Removes.push(path)
    s3.delete(path)
    return { path }
  },
}))
const bytes = (text: string) => new TextEncoder().encode(text)
const text = (key: string) => {
  const b = s3.get(key)
  return b === undefined ? undefined : new TextDecoder().decode(b)
}
const s3Snapshot = () => Object.fromEntries([...s3.keys()].sort().map((k) => [k, text(k)]))
// Every S3 key the stored post serves (the runtime's layout: the version
// prefix for a valid `body.version`, else the legacy per-slug prefix).
function liveKeys(p: Post): string[] {
  const b = p.body as { files: string[]; version?: string }
  const prefix = b.version ? `public/static/_v/${encodeURIComponent(p.slug)}/${b.version}/` : `public/static/${p.slug}/`
  return b.files.map((f) => `${prefix}${f}`)
}

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
  // Runs once at the start of the next update, before its compare-and-swap
  // — i.e. after the form's bundle upload and before its write lands.
  let beforeNextUpdate: (() => void) | null = null
  let deleted = false

  function apply(patch: Partial<Post>) {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    row = { ...row, ...clone(defined), updatedAt: bump() }
  }

  const update = vi.fn(async (postId: string, data: Partial<Post>, options?: UpdatePostOptions) => {
    const hook = beforeNextUpdate
    beforeNextUpdate = null
    hook?.()
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
    remove: async (postId: string) => {
      if (postId !== row.postId) throw new Error(`no post ${postId}`)
      deleted = true
    },
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
    onBeforeNextUpdate(fn: () => void) {
      beforeNextUpdate = fn
    },
    get deleted() {
      return deleted
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

// A second, independent form instance (another editor) on the same post.
interface Editor {
  container: HTMLElement
  typeTitle(value: string): Promise<void>
  pickBundle(files: Record<string, string>): Promise<void>
  submit(): Promise<void>
  errorText(): string | null
  titleValue(): string
}
const editorRoots: { root: Root; container: HTMLElement }[] = []
// `[id="title"]`, not `#title`: with two forms in the document jsdom
// resolves `#id` through the document-wide id lookup and misses the second.
const TITLE = 'input[id="title"]'

async function mountEditor(p: Post): Promise<Editor> {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const r = createRoot(el)
  editorRoots.push({ root: r, container: el })
  const { locale, dict } = resolveLocale('en')
  await act(async () => {
    r.render(
      <I18nProvider locale={locale} dict={dict}>
        <PostForm post={p} availablePostClasses={CLASSES} />
      </I18nProvider>,
    )
  })
  return {
    container: el,
    async typeTitle(value) {
      const input = el.querySelector(TITLE) as HTMLInputElement
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    },
    // Picks loose files in the real StaticUploader (no zip), which reads
    // and validates them and hands the pending bundle to the form.
    async pickBundle(files) {
      const input = el.querySelector('input[type="file"]') as HTMLInputElement
      const picked = Object.entries(files).map(([name, text]) => new File([text], name, { type: 'text/html' }))
      Object.defineProperty(input, 'files', { configurable: true, value: picked })
      await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }))
      })
      // File reads resolve asynchronously; wait until the uploader shows
      // the pending bundle.
      for (let i = 0; i < 20 && !el.textContent?.includes('Pending upload'); i++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
      }
      expect(el.textContent).toContain('Pending upload')
    },
    async submit() {
      await act(async () => {
        el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
    },
    errorText: () => el.querySelector('p.text-destructive')?.textContent ?? null,
    titleValue: () => (el.querySelector(TITLE) as HTMLInputElement).value,
  }
}

beforeEach(() => {
  localStorage.clear()
  routerPush.mockClear()
  s3.clear()
  s3Uploads.length = 0
  s3Removes.length = 0
  restoreRevision = null
})
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  for (const e of editorRoots.splice(0)) {
    await act(async () => e.root.unmount())
    e.container.remove()
  }
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

// The stored metadata comes from `JSON.parse` (AWSJSON), so an own
// `__proto__` key is legitimate data, not a prototype.
describe('PostForm keeps an own `__proto__` metadata key', () => {
  it('a title-only save writes it back unchanged', async () => {
    const p: Post = { ...initialPost(), metadata: JSON.parse('{"__proto__":{"plugin":"x"},"seo":{"title":"S"}}') }
    const store = makeStore(p, { conditional: true })
    setPostsProvider(store.provider)
    await mount(p)

    await typeTitle('Weekly 2')
    await submit()

    expect(errorText()).toBeNull()
    expect(store.update).toHaveBeenCalledTimes(1)
    const written = store.update.mock.calls[0]![1].metadata!
    expect(Object.prototype.hasOwnProperty.call(written, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(written)).toBe(Object.prototype)
    expect(JSON.stringify(written)).toBe('{"__proto__":{"plugin":"x"},"seo":{"title":"S"}}')
    expect(store.row.title).toBe('Weekly 2')
  })
})

// Two real PostForm instances (editors A and B) saving the same post
// through the real core, the in-memory CAS store and the in-memory S3.
const HTML = 'text/html; charset=utf-8'
const v1Body = { entrypoint: 'index.html', files: ['index.html'], uploadedAt: 'v1' }
const v1Files = { 'index.html': { size: 9, mimeType: HTML } }
const LEGACY_KEY = 'public/static/weekly/index.html'
// A legacy (unversioned) static post with its bundle in S3.
const staticPost = (): Post => ({
  ...initialPost(),
  format: 'static',
  body: v1Body,
  metadata: { files: v1Files, plugin_x: { n: 1 } },
})
// A static post whose bundle is the immutable version `v1`.
const VERSIONED_KEY = 'public/static/_v/weekly/v1/index.html'
const versionedPost = (): Post => ({ ...staticPost(), body: { ...v1Body, version: 'v1' } })
function seedS3(p: Post) {
  for (const key of liveKeys(p)) s3.set(key, bytes('<p>v1</p>'))
}
const versionOf = (p: Post) => (p.body as { version?: string }).version
const VERSION_RE = /^[a-z0-9]+-[0-9a-f]{10}$/

describe('two editors saving the same post', () => {
  it('static: a title-only save after another editor replaced the bundle keeps that bundle, consistently', async () => {
    const store = makeStore(staticPost(), { conditional: true })
    seedS3(store.row)
    setPostsProvider(store.provider)
    const a = await mountEditor(store.row)
    const b = await mountEditor(store.row)

    await b.pickBundle({ 'index.html': '<p>v2</p>', 'about.html': '<p>about</p>' })
    await b.submit()
    expect(b.errorText()).toBeNull()
    expect(s3Uploads).toHaveLength(2)
    const afterB = store.row
    expect(afterB.body).toMatchObject({ entrypoint: 'index.html', files: ['about.html', 'index.html'] })
    expect(versionOf(afterB)).toMatch(VERSION_RE)
    const s3AfterB = s3Snapshot()

    // A still holds bundle v1 in its state.
    await a.typeTitle('Weekly by A')
    await a.submit()

    expect(a.errorText()).toBeNull()
    expect(s3Uploads).toHaveLength(2) // A uploads nothing
    expect(s3Snapshot()).toEqual(s3AfterB) // ...and deletes nothing
    expect(store.row.title).toBe('Weekly by A')
    expect(store.row.format).toBe('static')
    // Manifest and files both from B's v2 — never v1 body with v2 files.
    expect(store.row.body).toEqual(afterB.body)
    expect(store.row.metadata).toEqual(afterB.metadata)
    expect(Object.keys((store.row.metadata as { files: object }).files).sort()).toEqual(
      (store.row.body as { files: string[] }).files,
    )
    expect(store.row.metadata).toEqual({
      files: { 'about.html': { size: 12, mimeType: HTML }, 'index.html': { size: 9, mimeType: HTML } },
      plugin_x: { n: 1 },
    })
    for (const key of liveKeys(store.row)) expect(s3.has(key)).toBe(true)
  })

  it('static: both editors replacing the bundle — the second save is a static conflict and uploads nothing', async () => {
    const store = makeStore(staticPost(), { conditional: true })
    seedS3(store.row)
    setPostsProvider(store.provider)
    const a = await mountEditor(store.row)
    const b = await mountEditor(store.row)

    await b.pickBundle({ 'index.html': '<p>v2</p>', 'about.html': '<p>about</p>' })
    await a.pickBundle({ 'index.html': '<p>by A</p>' })
    await b.submit()
    expect(b.errorText()).toBeNull()
    const afterB = store.row
    const s3AfterB = s3Snapshot()
    expect(s3Uploads).toHaveLength(2)

    await a.typeTitle('Weekly by A')
    await a.submit()

    expect(a.errorText()).toBe(
      'The static bundle was changed elsewhere while you edited it. Nothing was saved — reload the post to see the other bundle.',
    )
    // Detected before the upload: A's bundle never reached S3, and B's
    // consistent bundle is intact.
    expect(s3Uploads).toHaveLength(2)
    expect(s3Snapshot()).toEqual(s3AfterB)
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(store.row).toEqual(afterB)
    // A keeps its state, pending bundle included.
    expect(a.titleValue()).toBe('Weekly by A')
    expect(a.container.textContent).toContain('Pending upload: 1 files')
  })

  it('static: a new bundle uploads and is written when nobody else changed the bundle', async () => {
    const store = makeStore(staticPost(), { conditional: true })
    seedS3(store.row)
    setPostsProvider(store.provider)
    const a = await mountEditor(store.row)
    const b = await mountEditor(store.row)

    await b.typeTitle('Weekly by B')
    await b.submit()
    await a.pickBundle({ 'index.html': '<p>by A</p>' })
    await a.submit()

    expect(a.errorText()).toBeNull()
    expect(s3Uploads).toHaveLength(1)
    expect(store.row.title).toBe('Weekly')
    expect(store.row.body).toMatchObject({ entrypoint: 'index.html', files: ['index.html'] })
    expect(store.row.metadata).toEqual({ files: { 'index.html': { size: 11, mimeType: HTML } }, plugin_x: { n: 1 } })
  })

  it('non-static: body stays last-write-wins (unchanged behaviour)', async () => {
    const store = makeStore(initialPost(), { conditional: true })
    setPostsProvider(store.provider)
    const a = await mountEditor(store.row)
    const b = await mountEditor(store.row)

    const textarea = b.container.querySelector('textarea.font-mono') as HTMLTextAreaElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'body by B')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await b.submit()
    expect(store.row.body).toBe('body by B')

    await a.typeTitle('Weekly by A')
    await a.submit()

    expect(a.errorText()).toBeNull()
    expect(store.row.title).toBe('Weekly by A')
    expect(store.row.body).toBe('hello') // A's loaded body overwrites B's
    expect(s3Uploads).toHaveLength(0)
  })
})

// The bundle a stored post references is never modified before that post's
// replacement is committed: uploads go to a fresh immutable version prefix.
describe('static bundle storage: immutable versions, swapped by the post write', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  for (const [layout, make] of [
    ['legacy', staticPost],
    ['versioned', versionedPost],
  ] as const) {
    it(`${layout}: a write landing between A's upload and A's write — A conflicts, the live bundle is intact, A's upload is removed`, async () => {
      const store = makeStore(make(), { conditional: true })
      seedS3(store.row)
      setPostsProvider(store.provider)
      const s3Before = s3Snapshot()
      const a = await mountEditor(store.row)

      await a.pickBundle({ 'index.html': '<p>by A</p>', 'extra.html': '<p>extra</p>' })
      // B's save (here a title edit, keeping the bundle) lands after A has
      // uploaded its files and before A's write.
      store.onBeforeNextUpdate(() => {
        expect(s3Uploads).toHaveLength(2) // A's upload is done
        store.concurrentWrite({ title: 'Weekly by B' })
      })
      await a.submit()

      expect(a.errorText()).toBe(CONFLICT_MESSAGE)
      // The stored post is B's, and every file it serves still exists with
      // its original bytes.
      expect(store.row.title).toBe('Weekly by B')
      expect(store.row.body).toEqual(make().body)
      for (const key of liveKeys(store.row)) expect(text(key)).toBe('<p>v1</p>')
      // A's uploaded version is cleaned up: S3 is exactly as before.
      expect(s3Uploads.every((k) => k.startsWith('public/static/_v/weekly/'))).toBe(true)
      expect(s3Snapshot()).toEqual(s3Before)
      // A keeps its state, pending bundle included.
      expect(a.container.textContent).toContain('Pending upload: 2 files')
    })
  }

  it('legacy: replacing the bundle writes a versioned body and leaves the legacy files untouched', async () => {
    const store = makeStore(staticPost(), { conditional: true })
    seedS3(store.row)
    setPostsProvider(store.provider)
    const a = await mountEditor(store.row)

    await a.pickBundle({ 'index.html': '<p>by A</p>', 'about.html': '<p>about</p>' })
    await a.submit()

    expect(a.errorText()).toBeNull()
    const version = versionOf(store.row)
    expect(version).toMatch(VERSION_RE)
    expect(store.row.body).toMatchObject({ entrypoint: 'index.html', files: ['about.html', 'index.html'], version })
    expect(text(`public/static/_v/weekly/${version}/index.html`)).toBe('<p>by A</p>')
    expect(text(`public/static/_v/weekly/${version}/about.html`)).toBe('<p>about</p>')
    expect(text(LEGACY_KEY)).toBe('<p>v1</p>')
    expect(s3Removes).toEqual([])
    expect(routerPush).toHaveBeenCalledWith('/admin/posts')
  })

  it('versioned: replacing the bundle again garbage-collects the previous version after the write', async () => {
    const store = makeStore(versionedPost(), { conditional: true })
    seedS3(store.row)
    s3.set(LEGACY_KEY, bytes('<p>legacy</p>')) // an unrelated legacy orphan
    setPostsProvider(store.provider)
    const a = await mountEditor(store.row)

    await a.pickBundle({ 'index.html': '<p>by A</p>' })
    await a.submit()

    expect(a.errorText()).toBeNull()
    const version = versionOf(store.row)!
    expect(version).toMatch(VERSION_RE)
    expect(version).not.toBe('v1')
    expect(s3Snapshot()).toEqual({
      [LEGACY_KEY]: '<p>legacy</p>',
      [`public/static/_v/weekly/${version}/index.html`]: '<p>by A</p>',
    })
    expect(s3Removes).toEqual([VERSIONED_KEY])
  })

  it('a cleanup failure after a successful replace is logged and does not fail the save', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = makeStore(versionedPost(), { conditional: true })
    seedS3(store.row)
    setPostsProvider(store.provider)
    const a = await mountEditor(store.row)
    await a.pickBundle({ 'index.html': '<p>by A</p>' })
    const storage = await import('aws-amplify/storage')
    vi.spyOn(storage, 'remove').mockRejectedValue(new Error('S3 down'))

    await a.submit()

    expect(a.errorText()).toBeNull()
    expect(versionOf(store.row)).toMatch(VERSION_RE)
    expect(routerPush).toHaveBeenCalledWith('/admin/posts')
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('failed to remove replaced static bundle version v1'),
      expect.any(Error),
    )
    expect(s3.has(VERSIONED_KEY)).toBe(true) // left as an orphan
  })

  it('restoring a static revision is refused: body, format and files stay, and a later save keeps the bundle', async () => {
    const store = makeStore(versionedPost(), { conditional: true })
    seedS3(store.row)
    setPostsProvider(store.provider)
    const s3Before = s3Snapshot()
    const a = await mountEditor(store.row)

    // An older revision with another bundle (whose files are gone).
    await act(async () => {
      restoreRevision!({
        title: 'Old title',
        slug: 'weekly',
        format: 'static',
        body: { entrypoint: 'old.html', files: ['old.html'], uploadedAt: 'v0', version: 'v0' },
        status: 'draft',
        metadata: { files: { 'old.html': { size: 3, mimeType: HTML } } },
      })
    })

    const notice = a.container.querySelector('[data-testid="static-restore-rejected"]')
    expect(notice?.textContent).toContain("This revision can't be restored here because it would change the static bundle")
    // Nothing was applied.
    expect(a.titleValue()).toBe('Weekly')
    expect((a.container.querySelector('select#format') as HTMLSelectElement).value).toBe('static')
    expect(a.container.textContent).toContain('Current bundle: 1 files (entry: index.html)')

    // A non-static revision onto the static post is refused the same way.
    await act(async () => {
      restoreRevision!({ title: 'Markdown era', slug: 'weekly', format: 'markdown', body: 'old', status: 'draft' })
    })
    expect(a.titleValue()).toBe('Weekly')
    expect((a.container.querySelector('select#format') as HTMLSelectElement).value).toBe('static')

    await a.typeTitle('Weekly 2')
    await a.submit()

    expect(a.errorText()).toBeNull()
    expect(store.row.title).toBe('Weekly 2')
    expect(store.row.format).toBe('static')
    expect(store.row.body).toEqual(versionedPost().body)
    expect(store.row.metadata).toEqual(versionedPost().metadata)
    expect(s3Snapshot()).toEqual(s3Before)
    expect(s3Uploads).toEqual([])
  })

  it('a static revision with the current manifest (title-only change) still restores', async () => {
    const store = makeStore(versionedPost(), { conditional: true })
    seedS3(store.row)
    setPostsProvider(store.provider)
    const a = await mountEditor(store.row)

    await act(async () => {
      restoreRevision!({ ...versionedPost(), title: 'Old title' })
    })

    expect(a.container.querySelector('[data-testid="static-restore-rejected"]')).toBeNull()
    expect(a.titleValue()).toBe('Old title')
  })

  it('deleting a static post removes its legacy prefix and every versioned bundle of the slug', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const store = makeStore(versionedPost(), { conditional: true })
    seedS3(store.row)
    s3.set(LEGACY_KEY, bytes('<p>legacy</p>'))
    s3.set('public/static/_v/weekly/orphan-1/index.html', bytes('orphan'))
    // Other slugs are not touched.
    s3.set('public/static/_v/weekly-2/v1/index.html', bytes('other'))
    s3.set('public/static/weekly-2/index.html', bytes('other'))
    setPostsProvider(store.provider)
    const a = await mountEditor(store.row)

    const del = Array.from(a.container.querySelectorAll('button')).find((b) => b.textContent === 'Delete')!
    await click(del)

    expect(store.deleted).toBe(true)
    expect(s3Snapshot()).toEqual({
      'public/static/_v/weekly-2/v1/index.html': 'other',
      'public/static/weekly-2/index.html': 'other',
    })
  })

  it('creating a static post uploads a version; a failed create removes it again', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = makeStore(initialPost(), { conditional: true })
    store.provider.create = vi.fn(async () => {
      throw new Error('create failed')
    })
    setPostsProvider(store.provider)
    const el = document.createElement('div')
    document.body.appendChild(el)
    const r = createRoot(el)
    editorRoots.push({ root: r, container: el })
    const { locale, dict } = resolveLocale('en')
    await act(async () => {
      r.render(
        <I18nProvider locale={locale} dict={dict}>
          <PostForm availablePostClasses={CLASSES} />
        </I18nProvider>,
      )
    })
    const select = el.querySelector('select#format') as HTMLSelectElement
    await act(async () => {
      select.value = 'static'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const title = el.querySelector(TITLE) as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'New LP')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const input = el.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['<p>new</p>'], 'index.html', { type: 'text/html' })],
    })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    for (let i = 0; i < 20 && !el.textContent?.includes('Pending upload'); i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
    await act(async () => {
      el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(el.querySelector('p.text-destructive')?.textContent).toBe('create failed')
    expect(s3Uploads).toHaveLength(1)
    expect(s3Uploads[0]).toMatch(/^public\/static\/_v\/new-lp\/[a-z0-9]+-[0-9a-f]{10}\/index\.html$/)
    expect(s3Snapshot()).toEqual({})
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('failed to remove'), expect.anything())
  })
})
