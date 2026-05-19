'use client'

import { useState } from 'react'
import { FileText, AlertTriangle, FileArchive, X } from 'lucide-react'
import { Button } from '@ampless/runtime/ui'
import type { StaticPostBody } from 'ampless'
import {
  extractZip,
  validateBundle,
  validateBundlePath,
  type ExtractedFile,
  type ValidationIssue,
} from '../lib/static-bundle.js'
import { useT } from './i18n-provider.js'

interface Props {
  /** Initial body when editing an already-uploaded bundle. */
  initial?: StaticPostBody | null
  /**
   * Called when the user has picked / dropped files and they've been
   * extracted + validated. Parent saves the post, which triggers the
   * actual S3 upload via `uploadBundle()`.
   */
  onFilesReady: (files: ExtractedFile[], suggestedEntrypoint: string) => void
  /**
   * Called when the user clears the pending bundle without saving.
   * The previously-uploaded bundle (if any) stays on S3.
   */
  onClear: () => void
}

/**
 * Bundle picker for the static post format. Accepts either a single
 * .zip or any number of loose files (uses webkitdirectory when the
 * browser supports it so dragging a folder works too).
 *
 * Validation runs synchronously after extraction; absolute-path issues
 * block the parent's save action. The parent gets the in-memory
 * ExtractedFile[] back via `onFilesReady` so it can persist them via
 * `uploadBundle()` when the post is saved.
 */
export function StaticUploader({ initial, onFilesReady, onClear }: Props) {
  const t = useT()
  const [pending, setPending] = useState<ExtractedFile[] | null>(null)
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleZip(file: File) {
    setBusy(true)
    setError(null)
    try {
      const { files, issues: structuralIssues } = await extractZip(file)
      if (files.length === 0) {
        setError(t('posts.form.static.emptyBundle'))
        return
      }
      const contentIssues = validateBundle(files)
      const all = [...structuralIssues, ...contentIssues]
      setPending(files)
      setIssues(all)
      if (all.length === 0) {
        onFilesReady(files, guessEntrypoint(files))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleLooseFiles(files: FileList) {
    setBusy(true)
    setError(null)
    try {
      const extracted: ExtractedFile[] = []
      const structural: ValidationIssue[] = []
      for (const f of Array.from(files)) {
        // Browsers attach the original relative path under
        // `webkitRelativePath` when the user selects a directory.
        // Falling back to plain `name` keeps single-file selection
        // working (no nested dirs needed for trivial bundles).
        const rel =
          (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name
        // Strip the wrapper folder (`MyBundle/...`) so the bundle root
        // is the entrypoint's directory — same convention extractZip
        // applies for zipped folders.
        const stripped = rel.includes('/') ? rel.slice(rel.indexOf('/') + 1) : rel
        const reason = validateBundlePath(stripped)
        if (reason) {
          structural.push({ path: stripped, reason })
          continue
        }
        const buf = new Uint8Array(await f.arrayBuffer())
        extracted.push({ path: stripped, data: buf })
      }
      if (extracted.length === 0) {
        setError(t('posts.form.static.emptyBundle'))
        return
      }
      const content = validateBundle(extracted)
      const all = [...structural, ...content]
      setPending(extracted)
      setIssues(all)
      if (all.length === 0) {
        onFilesReady(extracted, guessEntrypoint(extracted))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function onPickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files
    if (!fl || fl.length === 0) return
    e.target.value = '' // allow re-picking the same file
    if (fl.length === 1 && fl[0]!.name.toLowerCase().endsWith('.zip')) {
      void handleZip(fl[0]!)
    } else {
      void handleLooseFiles(fl)
    }
  }

  function clearPending() {
    setPending(null)
    setIssues([])
    setError(null)
    onClear()
  }

  const showCurrent = !pending && initial && initial.files.length > 0

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-dashed p-4">
        <label className="flex flex-col items-start gap-2 text-sm">
          <span className="font-medium">{t('posts.form.static.pick')}</span>
          <input
            type="file"
            accept=".zip,application/zip,*/*"
            multiple
            onChange={onPickerChange}
            disabled={busy}
          />
          <span className="text-xs text-muted-foreground">
            {t('posts.form.static.pickHint')}
          </span>
        </label>
        {busy && <p className="mt-2 text-sm text-muted-foreground">{t('common.loading')}</p>}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>

      {showCurrent && (
        <CurrentBundle body={initial!} />
      )}

      {pending && (
        <PendingBundle
          files={pending}
          issues={issues}
          onClear={clearPending}
        />
      )}
    </div>
  )
}

function CurrentBundle({ body }: { body: StaticPostBody }) {
  const t = useT()
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <FileArchive className="h-4 w-4" />
        {t('posts.form.static.currentBundle', {
          count: body.files.length,
          entrypoint: body.entrypoint,
        })}
      </div>
      <FileList files={body.files} />
    </div>
  )
}

function PendingBundle({
  files,
  issues,
  onClear,
}: {
  files: ExtractedFile[]
  issues: ValidationIssue[]
  onClear: () => void
}) {
  const t = useT()
  const totalBytes = files.reduce((sum, f) => sum + f.data.byteLength, 0)

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium">
        <span className="flex items-center gap-2">
          <FileArchive className="h-4 w-4" />
          {t('posts.form.static.pendingBundle', {
            count: files.length,
            size: formatBytes(totalBytes),
          })}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          <X className="mr-1 h-3 w-3" />
          {t('common.cancel')}
        </Button>
      </div>

      {issues.length > 0 && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
          <div className="mb-1 flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {t('posts.form.static.issuesTitle', { count: issues.length })}
          </div>
          <ul className="space-y-0.5 text-xs">
            {issues.slice(0, 20).map((issue, idx) => (
              <li key={`${issue.path}-${idx}`} className="font-mono">
                {issue.path}: {issue.reason}
              </li>
            ))}
            {issues.length > 20 && (
              <li className="font-mono text-muted-foreground">
                … {issues.length - 20} more
              </li>
            )}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('posts.form.static.issuesHint')}
          </p>
        </div>
      )}

      <FileList files={files.map((f) => f.path)} />
    </div>
  )
}

function FileList({ files }: { files: string[] }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {files.slice(0, 40).map((path) => (
        <li key={path} className="flex items-center gap-1.5 font-mono text-muted-foreground">
          <FileText className="h-3 w-3 shrink-0" />
          {path}
        </li>
      ))}
      {files.length > 40 && (
        <li className="font-mono text-xs text-muted-foreground">… {files.length - 40} more</li>
      )}
    </ul>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function guessEntrypoint(files: ExtractedFile[]): string {
  const exact = files.find((f) => f.path === 'index.html')
  if (exact) return 'index.html'
  const alt = files.find((f) => f.path === 'index.htm')
  if (alt) return 'index.htm'
  const rootHtml = files
    .filter((f) => /^[^/]+\.html?$/.test(f.path))
    .sort((a, b) => a.path.localeCompare(b.path))[0]
  if (rootHtml) return rootHtml.path
  return files[0]?.path ?? 'index.html'
}
