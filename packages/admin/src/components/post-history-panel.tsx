'use client'

import { useCallback, useEffect, useState } from 'react'
import { listPostHistory, type Post, type PostRevision } from 'ampless'
import { Button } from '@ampless/runtime/ui'
import { useT } from './i18n-provider.js'
import { getAdminCmsConfig } from '../lib/admin-config-client.js'

interface PostHistoryPanelProps {
  postId: string
  /**
   * Pour a selected revision's fields into the editor form. The parent
   * (PostForm) reviews and saves manually — restore never auto-saves.
   */
  onRestore: (revision: PostRevision) => void
  /**
   * Phase 7: endpoint that the panel POSTs a selected revision to for
   * server-rendered preview HTML. Defaults to `/admin/preview`, the
   * Route Handler shipped by the template scaffold. Same prop the
   * `<PostForm>` preview uses; template factories thread it down so
   * revision previews benefit from the same server-side rendering
   * pipeline (contentFields renderers + page-level scripts).
   */
  previewEndpoint?: string
}

// How many revisions to fetch per page. History is unbounded by default,
// so we page through the `byPost` GSI with the returned nextToken rather
// than assuming everything fits in one round-trip.
const PAGE_SIZE = 20

/**
 * Format a revision timestamp (date + time) in the project's configured
 * timezone so SSR/CSR never drift and editors see times in the site's
 * locale. Falls back to the raw ISO string if Intl chokes on the TZ.
 */
function formatRevisedAt(iso: string, timezone: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    }).format(d)
  } catch {
    return iso
  }
}

/**
 * Build a Post-shaped object from a revision so `renderBody` can render
 * it read-only (same renderer the form preview uses). Static revisions
 * are handled separately by the caller (no renderable body).
 */
function revisionAsPost(rev: PostRevision): Post {
  return {
    postId: rev.postId,
    slug: rev.slug ?? '',
    title: rev.title ?? '',
    excerpt: rev.excerpt,
    format: rev.format ?? 'markdown',
    body: rev.body,
    status: rev.status ?? 'draft',
    publishedAt: rev.publishedAt,
    tags: rev.tags ?? [],
    metadata: rev.metadata,
  }
}

export function PostHistoryPanel({
  postId,
  onRestore,
  previewEndpoint = '/admin/preview',
}: PostHistoryPanelProps) {
  const t = useT()
  const config = getAdminCmsConfig()
  const timezone = config?.timezone ?? 'UTC'
  const locale = config?.locale ?? 'en'

  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revisions, setRevisions] = useState<PostRevision[]>([])
  const [nextToken, setNextToken] = useState<string | undefined>(undefined)
  const [selected, setSelected] = useState<PostRevision | null>(null)
  // Phase 7: preview HTML rendered server-side via the template's
  // `/admin/preview` Route Handler. Re-fetched whenever the user
  // picks a different revision.
  const [previewHtml, setPreviewHtml] = useState('')

  // A revision is uniquely identified by its `postHistoryId`; using it
  // as the primitive dep keeps the effect from re-firing on shallow
  // re-renders that don't actually change the selection. The `format`
  // primitive guards against accidentally previewing a static
  // revision (which has no renderable body — see `format === 'static'`
  // skip below).
  const selectedHistoryId = selected?.postHistoryId
  const selectedFormat = selected?.format
  useEffect(() => {
    if (!selected) return
    if (selected.format === 'static') return
    const ctrl = new AbortController()
    fetch(previewEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(revisionAsPost(selected)),
      signal: ctrl.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`preview ${r.status}`)
        return r.text()
      })
      .then((html) => {
        if (!ctrl.signal.aborted) setPreviewHtml(html)
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return
        // eslint-disable-next-line no-console
        console.error('[ampless admin] revision preview fetch failed:', err)
      })
    return () => ctrl.abort()
    // `selected` itself is a new reference when the user clicks a
    // different row; we depend on its identifying primitives to keep
    // the deps array shallow per the same convention as <PostForm>'s
    // preview effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHistoryId, selectedFormat, previewEndpoint])

  const loadPage = useCallback(
    async (token?: string) => {
      setLoading(true)
      setError(null)
      try {
        const conn = await listPostHistory(postId, { limit: PAGE_SIZE, nextToken: token })
        setRevisions((prev) => (token ? [...prev, ...conn.items] : conn.items))
        setNextToken(conn.nextToken)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [postId]
  )

  // Lazy-load the first page only when the panel is first opened, so the
  // editor page doesn't pay for a history query nobody looked at.
  useEffect(() => {
    if (open && !loaded) {
      setLoaded(true)
      void loadPage()
    }
  }, [open, loaded, loadPage])

  return (
    <section className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
      >
        <span>{t('posts.history.title')}</span>
        <span className="text-muted-foreground" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t px-4 py-4">
          {error && <p className="text-sm text-destructive">{error}</p>}

          {loading && revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('posts.history.empty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">
                      {t('posts.history.columnRevisedAt')}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t('posts.history.columnStatus')}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t('posts.history.columnTitle')}
                    </th>
                    <th className="px-3 py-2 font-medium text-right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {revisions.map((rev) => (
                    <tr
                      key={rev.postHistoryId}
                      className={
                        selected?.postHistoryId === rev.postHistoryId
                          ? 'border-b bg-muted/50'
                          : 'border-b'
                      }
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                        {formatRevisedAt(rev.revisedAt, timezone, locale)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs text-muted-foreground">
                          {rev.status ? t(`common.${rev.status}`) : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2">{rev.title || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setSelected(rev)}
                          >
                            {t('posts.history.view')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (confirm(t('posts.history.restoreConfirm'))) onRestore(rev)
                            }}
                          >
                            {t('posts.history.restore')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {nextToken && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => void loadPage(nextToken)}
              >
                {loading ? t('common.loading') : t('posts.history.loadMore')}
              </Button>
            </div>
          )}

          {selected && (
            <div className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">
                  {t('posts.history.viewing', {
                    date: formatRevisedAt(selected.revisedAt, timezone, locale),
                  })}
                </h4>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(null)}
                >
                  {t('common.cancel')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono uppercase">{selected.format ?? '—'}</span>
                {selected.slug && (
                  <>
                    <span className="mx-2">·</span>
                    <span className="font-mono">{selected.slug}</span>
                  </>
                )}
              </p>
              {selected.format === 'static' ? (
                <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                  {t('posts.history.staticCaveat')}
                </p>
              ) : (
                // Sandbox is `allow-scripts allow-same-origin`. With
                // srcDoc, this gives the iframe the admin's origin so
                // 3rd-party embed widgets (YouTube SDK, x.com widgets.js)
                // can initialise — they refuse to work in an opaque-origin
                // (`allow-scripts` only) iframe.
                //
                // Trust boundary (v1 explicit design decision): ampless
                // treats admin preview content / plugin script as trusted.
                // Same-origin gives the preview script access to the
                // admin's auth state / non-HttpOnly storage / DOM, and
                // lets it issue authenticated same-origin XHR / fetch.
                // In PostHistoryPanel the previewed body is a past
                // revision which may have been authored by a different
                // editor (= revision author ≠ preview viewer). With
                // same-origin, scripts in that historical body /
                // publicPostScript can touch the current editor's admin
                // session. v1 explicitly accepts this as inside the trust
                // boundary because plugins were audited by the engineer at
                // install time and revision authors are trusted editors of
                // this site. A stricter sandbox (= separate-origin preview
                // route + CSP / COEP / COOP) is parked for v2.0+ if/when
                // a real plugin marketplace lands.
                <iframe
                  title="revision-preview"
                  srcDoc={previewHtml}
                  sandbox="allow-scripts allow-same-origin"
                  className="prose prose-neutral dark:prose-invert max-w-none min-h-[300px] w-full rounded-md border text-sm"
                />
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
