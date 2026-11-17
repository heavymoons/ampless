// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Post } from 'ampless'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock('./post-history-panel.js', () => ({ PostHistoryPanel: () => null }))

const { PostForm } = await import('./post-form.js')
const { I18nProvider } = await import('./i18n-provider.js')
const { resolveLocale } = await import('../lib/i18n.js')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-06-01T12:00:00.000Z')

const post = (status: Post['status'], publishedAt?: string): Post => ({
  postId: 'p1',
  slug: 'weekly',
  title: 'Weekly',
  format: 'markdown',
  body: 'hello',
  status,
  publishedAt,
  tags: [],
})

let root: Root | null = null
let container: HTMLElement | null = null

async function mount(p: Post | undefined, locale: 'en' | 'ja' = 'en') {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const { locale: resolved, dict } = resolveLocale(locale)
  await act(async () => {
    root!.render(
      <I18nProvider locale={resolved} dict={dict}>
        <PostForm post={p} />
      </I18nProvider>
    )
  })
}
const publishedOption = () =>
  container!.querySelector('select#status option[value="published"]')!.textContent
const notice = () => container!.querySelector('p.text-amber-600')?.textContent ?? null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(NOW)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PostForm scheduled status label', () => {
  it('shows Scheduled + notice for a future publishedAt, and Published once it arrives', async () => {
    await mount(post('published', '2026-06-01T12:00:30.000Z'))
    expect((container!.querySelector('select#status') as HTMLSelectElement).value).toBe('published')
    expect(publishedOption()).toBe('Scheduled')
    expect(notice()).toContain('Scheduled')

    await act(async () => {
      vi.advanceTimersByTime(31_000)
    })
    expect(publishedOption()).toBe('Published')
    expect(notice()).toBeNull()
  })

  it('uses 公開予約 in ja', async () => {
    await mount(post('published', '2026-06-02T00:00:00.000Z'), 'ja')
    expect(publishedOption()).toBe('公開予約')
    expect(notice()).toContain('公開予約')
  })

  it('a past publishedAt or a draft keeps the stored labels', async () => {
    await mount(post('published', '2026-05-01T00:00:00.000Z'))
    expect(publishedOption()).toBe('Published')
    expect(notice()).toBeNull()
    await act(async () => root?.unmount())
    container?.remove()

    await mount(post('draft', '2099-01-01T00:00:00.000Z'))
    expect(publishedOption()).toBe('Published')
    expect(notice()).toBeNull()
  })

  it('switching a new post to published (first-publish "now" stamp) is not scheduled', async () => {
    await mount(undefined)
    // The render-time stamp is later than the hook's mount-time `now`; it
    // must still not count as a future (scheduled) publishedAt.
    vi.setSystemTime(NOW + 5_000)
    await act(async () => {
      const s = container!.querySelector('select#status') as HTMLSelectElement
      s.value = 'published'
      s.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(publishedOption()).toBe('Published')
    expect(notice()).toBeNull()
  })
})
