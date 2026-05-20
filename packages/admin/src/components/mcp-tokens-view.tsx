'use client'

import { useEffect, useState } from 'react'
import {
  Button,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ampless/runtime/ui'
import { useT } from './i18n-provider.js'

type Role = 'admin' | 'editor'

interface TokenRecord {
  hash: string
  label: string
  role: Role
  createdAt: string
  createdBy: string
  lastUsedAt?: string
}

const TOKENS_URL = '/api/admin/mcp-tokens'

export function McpTokensView() {
  const t = useT()
  const [tokens, setTokens] = useState<TokenRecord[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [role, setRole] = useState<Role>('admin')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdPlaintext, setCreatedPlaintext] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function loadTokens() {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(TOKENS_URL)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const body = (await res.json()) as { tokens: TokenRecord[] }
      setTokens(body.tokens)
    } catch (err) {
      console.error('[mcp-tokens] load failed', err)
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTokens()
  }, [])

  async function createToken(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch(TOKENS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), role }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const body = (await res.json()) as { token: string; record: TokenRecord }
      setCreatedPlaintext(body.token)
      setLabel('')
      // Refresh the list so the new row shows up immediately.
      void loadTokens()
    } catch (err) {
      console.error('[mcp-tokens] create failed', err)
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  async function revoke(hash: string) {
    if (!confirm(t('mcpTokens.revokeConfirm'))) return
    try {
      const res = await fetch(TOKENS_URL, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      void loadTokens()
    } catch (err) {
      console.error('[mcp-tokens] revoke failed', err)
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  async function copyToClipboard() {
    if (!createdPlaintext) return
    try {
      await navigator.clipboard.writeText(createdPlaintext)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.warn('[mcp-tokens] clipboard write failed', err)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">{t('mcpTokens.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('mcpTokens.description')}</p>
      </div>

      <section className="rounded-md border bg-card p-4 md:p-6">
        <h2 className="text-lg font-semibold">{t('mcpTokens.createTitle')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('mcpTokens.createHint')}</p>
        <form onSubmit={createToken} className="mt-4 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="mcp-label">{t('mcpTokens.labelLabel')}</Label>
            <Input
              id="mcp-label"
              value={label}
              placeholder={t('mcpTokens.labelPlaceholder')}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mcp-role">{t('mcpTokens.roleLabel')}</Label>
            <select
              id="mcp-role"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value === 'editor' ? 'editor' : 'admin')}
            >
              <option value="admin">{t('mcpTokens.roleAdmin')}</option>
              <option value="editor">{t('mcpTokens.roleEditor')}</option>
            </select>
          </div>
          {createError && <p className="text-sm text-destructive">{createError}</p>}
          <Button type="submit" disabled={creating || !label.trim()}>
            {creating ? t('mcpTokens.creating') : t('mcpTokens.createButton')}
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('mcpTokens.listTitle')}</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('mcpTokens.loading')}</p>
        ) : loadError ? (
          <p className="text-sm text-destructive">
            {t('mcpTokens.error')}: {loadError}
          </p>
        ) : !tokens || tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('mcpTokens.listEmpty')}</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('mcpTokens.columnLabel')}</TableHead>
                  <TableHead>{t('mcpTokens.columnRole')}</TableHead>
                  <TableHead>{t('mcpTokens.columnCreated')}</TableHead>
                  <TableHead>{t('mcpTokens.columnLastUsed')}</TableHead>
                  <TableHead>{t('mcpTokens.columnActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((tok) => (
                  <TableRow key={tok.hash}>
                    <TableCell className="font-medium">{tok.label}</TableCell>
                    <TableCell>
                      {tok.role === 'admin'
                        ? t('mcpTokens.roleAdmin')
                        : t('mcpTokens.roleEditor')}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(tok.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {tok.lastUsedAt
                        ? new Date(tok.lastUsedAt).toLocaleString()
                        : t('mcpTokens.lastUsedNever')}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => revoke(tok.hash)}
                      >
                        {t('mcpTokens.revoke')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {createdPlaintext && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-md border bg-card p-6 shadow-lg">
            <h3 className="text-lg font-semibold">{t('mcpTokens.createdTitle')}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{t('mcpTokens.createdHint')}</p>
            <div className="mt-4 rounded-md border bg-muted/50 p-3">
              <code className="block break-all font-mono text-xs">{createdPlaintext}</code>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => void copyToClipboard()}>
                {copied ? t('mcpTokens.copied') : t('mcpTokens.copy')}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setCreatedPlaintext(null)
                  setCopied(false)
                }}
              >
                {t('mcpTokens.close')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
