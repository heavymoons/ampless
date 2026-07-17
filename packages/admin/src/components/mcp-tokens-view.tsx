'use client'

import { useEffect, useState } from 'react'
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ampless/runtime/ui'
import { useT } from './i18n-provider.js'
import { generateToken } from '../lib/mcp-token-format.js'
import {
  listTokens,
  createToken,
  revokeToken,
  type McpTokenMeta,
} from '../lib/mcp-token-storage.js'

interface Props {
  /** Cognito sub of the currently logged-in admin. */
  currentUserId: string
  currentUserEmail: string
  /**
   * MCP HTTP endpoint URL (the `mcp-handler` Lambda Function URL).
   * `null` when the project hasn't been deployed yet, so
   * `amplify_outputs.json` doesn't have `custom.mcp.endpoint` populated.
   */
  mcpEndpoint: string | null
  /** Public read-only endpoint; undefined hides the card, null reports missing configuration. */
  publicMcpEndpoint: string | null | undefined
}

type ExpirationPreset = 'never' | '30days' | '90days' | 'custom'

function tokenStatus(tok: McpTokenMeta): 'active' | 'revoked' | 'expired' {
  if (tok.revokedAt) return 'revoked'
  if (tok.expiresAt && new Date(tok.expiresAt) < new Date()) return 'expired'
  return 'active'
}

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function McpTokensView({
  currentUserId,
  currentUserEmail,
  mcpEndpoint,
  publicMcpEndpoint,
}: Props) {
  const t = useT()

  const [endpointCopied, setEndpointCopied] = useState(false)
  const [publicEndpointCopied, setPublicEndpointCopied] = useState(false)

  async function copyEndpoint() {
    if (!mcpEndpoint) return
    try {
      await navigator.clipboard.writeText(mcpEndpoint)
      setEndpointCopied(true)
      setTimeout(() => setEndpointCopied(false), 2000)
    } catch (err) {
      console.error('[mcp-tokens-view] copy endpoint failed', err)
    }
  }

  async function copyPublicEndpoint() {
    if (!publicMcpEndpoint) return
    try {
      await navigator.clipboard.writeText(publicMcpEndpoint)
      setPublicEndpointCopied(true)
      setTimeout(() => setPublicEndpointCopied(false), 2000)
    } catch (err) {
      console.error('[mcp-tokens-view] copy public endpoint failed', err)
    }
  }

  const [tokens, setTokens] = useState<McpTokenMeta[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [expPreset, setExpPreset] = useState<ExpirationPreset>('never')
  const [customDate, setCustomDate] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Token reveal modal state
  const [revealedPlain, setRevealedPlain] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function loadTokens() {
    setLoading(true)
    setLoadError(null)
    try {
      const list = await listTokens()
      setTokens(list)
    } catch (err) {
      console.error('[mcp-tokens-view] listTokens failed', err)
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTokens()
  }, [])

  function openCreateModal() {
    setExpPreset('never')
    setCustomDate('')
    setCreateError(null)
    setShowCreateModal(true)
  }

  function expiresAtFromPreset(): string | null {
    if (expPreset === 'never') return null
    if (expPreset === '30days') {
      const d = new Date()
      d.setDate(d.getDate() + 30)
      return d.toISOString()
    }
    if (expPreset === '90days') {
      const d = new Date()
      d.setDate(d.getDate() + 90)
      return d.toISOString()
    }
    if (expPreset === 'custom' && customDate) {
      return new Date(customDate).toISOString()
    }
    return null
  }

  async function handleIssue() {
    setCreating(true)
    setCreateError(null)
    try {
      const { plain, hash, prefix } = generateToken()
      const meta = await createToken({
        hash,
        prefix,
        createdBy: currentUserId,
        createdByEmail: currentUserEmail,
        issuedAt: new Date().toISOString(),
        expiresAt: expiresAtFromPreset(),
      })
      void meta
      setShowCreateModal(false)
      setRevealedPlain(plain)
      void loadTokens()
    } catch (err) {
      console.error('[mcp-tokens-view] createToken failed', err)
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(hash: string) {
    if (!confirm(t('mcpTokens.revokeConfirm'))) return
    try {
      await revokeToken(hash)
      void loadTokens()
    } catch (err) {
      console.error('[mcp-tokens-view] revokeToken failed', err)
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  async function copyToClipboard() {
    if (!revealedPlain) return
    try {
      await navigator.clipboard.writeText(revealedPlain)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.warn('[mcp-tokens-view] clipboard write failed', err)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">{t('mcpTokens.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('mcpTokens.description')}</p>
        </div>
        <Button type="button" onClick={openCreateModal}>
          {t('mcpTokens.createButton')}
        </Button>
      </div>

      {/* Endpoint card */}
      <div className="rounded-md border bg-card px-4 py-3 text-sm">
        <p className="font-medium">{t('mcpTokens.endpointTitle')}</p>
        {mcpEndpoint ? (
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded border bg-muted px-2 py-1 font-mono text-xs">
              {mcpEndpoint}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={copyEndpoint}>
              {endpointCopied ? t('mcpTokens.endpointCopied') : t('mcpTokens.endpointCopy')}
            </Button>
          </div>
        ) : (
          <p className="mt-1 text-muted-foreground">{t('mcpTokens.endpointMissing')}</p>
        )}
      </div>

      {publicMcpEndpoint !== undefined && (
        <div className="rounded-md border bg-card px-4 py-3 text-sm">
          <p className="font-medium">{t('mcpTokens.publicEndpointTitle')}</p>
          <p className="mt-1 text-muted-foreground">
            {t('mcpTokens.publicEndpointDescription')}
          </p>
          {publicMcpEndpoint ? (
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded border bg-muted px-2 py-1 font-mono text-xs">
                {publicMcpEndpoint}
              </code>
              <Button type="button" variant="outline" size="sm" onClick={copyPublicEndpoint}>
                {publicEndpointCopied
                  ? t('mcpTokens.endpointCopied')
                  : t('mcpTokens.endpointCopy')}
              </Button>
            </div>
          ) : (
            <p className="mt-1 text-muted-foreground">
              {t('mcpTokens.publicEndpointMissing')}
            </p>
          )}
        </div>
      )}

      {/* Token list */}
      <section className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('mcpTokens.loading')}</p>
        ) : loadError ? (
          <p className="text-sm text-destructive">
            {t('mcpTokens.error')}: {loadError}
          </p>
        ) : !tokens || tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('mcpTokens.listEmpty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('mcpTokens.columnPrefix')}</TableHead>
                  <TableHead>{t('mcpTokens.columnCreated')}</TableHead>
                  <TableHead>{t('mcpTokens.columnLastUsed')}</TableHead>
                  <TableHead>{t('mcpTokens.columnStatus')}</TableHead>
                  <TableHead>{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((tok) => {
                  const status = tokenStatus(tok)
                  return (
                    <TableRow key={tok.hash}>
                      <TableCell className="font-mono text-xs">{tok.prefix}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <span title={tok.issuedAt}>{relativeTime(tok.issuedAt)}</span>
                        {tok.createdByEmail && (
                          <span className="ml-1 text-muted-foreground/70">
                            by {tok.createdByEmail}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {tok.lastUsedAt ? (
                          <span title={tok.lastUsedAt}>{relativeTime(tok.lastUsedAt)}</span>
                        ) : (
                          t('mcpTokens.lastUsedNever')
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            status === 'active'
                              ? 'text-sm font-medium text-green-700 dark:text-green-400'
                              : 'text-sm text-muted-foreground'
                          }
                        >
                          {status === 'active'
                            ? t('mcpTokens.statusActive')
                            : status === 'revoked'
                              ? t('mcpTokens.statusRevoked')
                              : t('mcpTokens.statusExpired')}
                        </span>
                      </TableCell>
                      <TableCell>
                        {status === 'active' && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleRevoke(tok.hash)}
                          >
                            {t('mcpTokens.revoke')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Create token modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-md border bg-card p-6 shadow-lg">
            <h2 className="text-lg font-semibold">{t('mcpTokens.createModalTitle')}</h2>

            <div className="mt-4 space-y-4">
              {/* Expiration */}
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('mcpTokens.expirationLabel')}</p>
                {(['never', '30days', '90days', 'custom'] as const).map((preset) => (
                  <label key={preset} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="mcp-expiration"
                      value={preset}
                      checked={expPreset === preset}
                      onChange={() => setExpPreset(preset)}
                    />
                    {t(`mcpTokens.expiration${preset.charAt(0).toUpperCase() + preset.slice(1)}`)}
                  </label>
                ))}
                {expPreset === 'custom' && (
                  <input
                    type="date"
                    className="mt-1 block rounded-md border bg-background px-2 py-1 text-sm"
                    value={customDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setCustomDate(e.target.value)}
                  />
                )}
              </div>

              {createError && <p className="text-sm text-destructive">{createError}</p>}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateModal(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                disabled={creating || (expPreset === 'custom' && !customDate)}
                onClick={() => void handleIssue()}
              >
                {creating ? t('mcpTokens.issuing') : t('mcpTokens.issueButton')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Token reveal modal */}
      {revealedPlain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-md border bg-card p-6 shadow-lg">
            <h2 className="text-lg font-semibold">{t('mcpTokens.revealTitle')}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('mcpTokens.revealHint')}</p>
            <div className="mt-4 rounded-md border bg-muted/50 p-3">
              <code className="block select-all break-all font-mono text-xs">{revealedPlain}</code>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void copyToClipboard()}
              >
                {copied ? t('mcpTokens.copied') : t('mcpTokens.copy')}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setRevealedPlain(null)
                  setCopied(false)
                }}
              >
                {t('mcpTokens.done')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
