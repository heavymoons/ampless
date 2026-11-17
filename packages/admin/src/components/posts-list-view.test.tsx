// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PostSummary } from 'ampless'

const listPostSummaries = vi.fn<() => Promise<PostSummary[]>>()
// Keep the pure helpers (filterSortPostSummaries / collectTags / formatDate)
// real; only the AppSync-backed list call is stubbed.
vi.mock('ampless', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ampless')>()),
  listPostSummaries: () => listPostSummaries(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const { PostsList } = await import('./posts-list-view.js')
const { I18nProvider } = await import('./i18n-provider.js')
const { resolveLocale } = await import('../lib/i18n.js')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-06-01T12:00:00.000Z')

const summary = (
  postId: string,
  status: PostSummary['status'],
  publishedAt?: string
): PostSummary => ({
  postId,
  slug: postId,
  title: `Title ${postId}`,
  status,
  publishedAt,
  updatedAt: '2026-05-01T00:00:00.000Z',
  tags: [],
})

const POSTS: PostSummary[] = [
  // Scheduled 30s from NOW, written with a +09:00 offset.
  summary('soon', 'published', '2026-06-01T21:00:30+09:00'),
  summary('later', 'published', '2026-07-01T00:00:00.000Z'),
  summary('live', 'published', '2026-05-01T00:00:00.000Z'),
  summary('wip', 'draft', '2099-01-01T00:00:00.000Z'),
]

let root: Root | null = null
let container: HTMLElement | null = null

async function mount(locale: 'en' | 'ja') {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const { locale: resolved, dict } = resolveLocale(locale)
  await act(async () => {
    root!.render(
      <I18nProvider locale={resolved} dict={dict}>
        <PostsList />
      </I18nProvider>
    )
  })
}

/** Badge label per row, keyed by slug. */
function badges(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of container!.querySelectorAll('tbody tr')) {
    const cells = row.querySelectorAll('td')
    out[cells[2]!.textContent!] = cells[1]!.textContent!
  }
  return out
}

async function chooseStatus(value: string) {
  await act(async () => {
    const s = container!.querySelector('select') as HTMLSelectElement
    s.value = value
    s.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  // Only timers + Date are faked so the mocked list promise still resolves.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(NOW)
  listPostSummaries.mockResolvedValue(POSTS)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PostsList scheduled status', () => {
  it('labels future published posts as Scheduled (en)', async () => {
    await mount('en')
    expect(badges()).toEqual({
      soon: 'Scheduled',
      later: 'Scheduled',
      live: 'Published',
      wip: 'Draft',
    })
    const scheduledBadge = [...container!.querySelectorAll('tbody span')].find(
      (el) => el.textContent === 'Scheduled'
    )
    expect(scheduledBadge!.className).toContain('bg-amber-100')
  })

  it('labels future published posts as 公開予約 (ja)', async () => {
    await mount('ja')
    expect(badges()).toEqual({
      soon: '公開予約',
      later: '公開予約',
      live: '公開済',
      wip: '下書き',
    })
    const option = container!.querySelector('option[value="scheduled"]')
    expect(option!.textContent).toBe('公開予約')
  })

  it('the scheduled filter shows only scheduled posts; published excludes them', async () => {
    await mount('en')
    await chooseStatus('scheduled')
    expect(Object.keys(badges()).sort()).toEqual(['later', 'soon'])
    await chooseStatus('published')
    expect(Object.keys(badges())).toEqual(['live'])
    await chooseStatus('draft')
    expect(Object.keys(badges())).toEqual(['wip'])
    await chooseStatus('all')
    expect(Object.keys(badges())).toHaveLength(4)
  })

  it('flips a badge to Published when its scheduled time arrives', async () => {
    await mount('en')
    await chooseStatus('published')
    expect(Object.keys(badges())).toEqual(['live'])

    // Just before the boundary nothing changes.
    await act(async () => {
      vi.advanceTimersByTime(29_000)
    })
    expect(Object.keys(badges())).toEqual(['live'])

    await act(async () => {
      vi.advanceTimersByTime(2_000)
    })
    expect(badges()).toEqual({ soon: 'Published', live: 'Published' })

    await chooseStatus('all')
    expect(badges().later).toBe('Scheduled')
  })
})
