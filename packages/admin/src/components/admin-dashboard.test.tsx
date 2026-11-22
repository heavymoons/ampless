// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PostSummary } from 'ampless'

const listPostSummaries = vi.fn<() => Promise<PostSummary[]>>()
vi.mock('ampless', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ampless')>()),
  listPostSummaries: () => listPostSummaries(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const { AdminDashboard } = await import('./admin-dashboard.js')
const { I18nProvider } = await import('./i18n-provider.js')
const { resolveLocale } = await import('../lib/i18n.js')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = Date.parse('2026-06-01T12:00:00.000Z')

const summary = (
  postId: string,
  status: PostSummary['status'],
  publishedAt?: string
): PostSummary => ({ postId, slug: postId, title: postId, status, publishedAt, tags: [] })

let root: Root | null = null
let container: HTMLElement | null = null

/** Card title → count, in render order. */
function counts(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of container!.querySelectorAll('p.text-3xl')) {
    const card = p.closest('.grid > *')!
    const title = card.firstElementChild!.textContent!
    out[title] = p.textContent!
  }
  return out
}

beforeEach(() => {
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

describe('AdminDashboard counts', () => {
  it('counts scheduled posts separately and moves them to published on arrival', async () => {
    listPostSummaries.mockResolvedValue([
      summary('soon', 'published', '2026-06-01T12:00:10.000Z'),
      summary('live', 'published', '2026-05-01T00:00:00.000Z'),
      summary('stamped', 'published'),
      summary('wip', 'draft', '2099-01-01T00:00:00.000Z'),
    ])
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const { locale, dict } = resolveLocale('en')
    await act(async () => {
      root!.render(
        <I18nProvider locale={locale} dict={dict}>
          <AdminDashboard />
        </I18nProvider>
      )
    })

    expect(counts()).toEqual({ Posts: '4', Published: '2', Scheduled: '1', Drafts: '1' })

    await act(async () => {
      vi.advanceTimersByTime(11_000)
    })
    expect(counts()).toEqual({ Posts: '4', Published: '3', Scheduled: '0', Drafts: '1' })
  })
})
