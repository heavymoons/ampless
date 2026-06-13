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
import { isWebAuthnSupported } from '../lib/passkey.js'
import { getPasskeyApi, type PasskeyCredential } from '../lib/passkey-store.js'

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString()
}

export function AccountView({ currentUserEmail, passkeysEnabled }: { currentUserEmail: string; passkeysEnabled: boolean }) {
  const t = useT()

  // WebAuthn support is resolved client-side (SSR has no `window`), so
  // the markup is gated in a useEffect to avoid a hydration mismatch.
  const [supported, setSupported] = useState(false)
  const [supportResolved, setSupportResolved] = useState(false)

  const [passkeys, setPasskeys] = useState<PasskeyCredential[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  async function loadPasskeys() {
    setLoading(true)
    setLoadError(null)
    try {
      const list = await getPasskeyApi().list()
      setPasskeys(list)
    } catch (err) {
      console.error('[account-view] list passkeys failed', err)
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!passkeysEnabled) {
      setSupportResolved(true)
      setLoading(false)
      return
    }
    const ok = isWebAuthnSupported()
    setSupported(ok)
    setSupportResolved(true)
    if (ok) void loadPasskeys()
    else setLoading(false)
  }, [passkeysEnabled])

  async function handleAdd() {
    // Call register() directly inside the click handler — Safari only
    // allows the WebAuthn ceremony to start from a user gesture, so we
    // must not await anything else first.
    setAdding(true)
    setAddError(null)
    try {
      await getPasskeyApi().register()
      await loadPasskeys()
    } catch (err) {
      console.error('[account-view] register passkey failed', err)
      setAddError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(credentialId: string) {
    if (!confirm(t('account.passkeys.deleteConfirm'))) return
    try {
      await getPasskeyApi().remove(credentialId)
      await loadPasskeys()
    } catch (err) {
      console.error('[account-view] remove passkey failed', err)
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">{t('account.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{currentUserEmail}</p>
      </div>

      {/* Passkeys card */}
      <section className="space-y-4 rounded-md border bg-card p-4 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{t('account.passkeys.title')}</h2>
          </div>
          {passkeysEnabled && supportResolved && supported && (
            <Button type="button" disabled={adding} onClick={() => void handleAdd()}>
              {adding ? t('account.passkeys.adding') : t('account.passkeys.add')}
            </Button>
          )}
        </div>

        {addError && <p className="text-sm text-destructive">{addError}</p>}

        {!passkeysEnabled ? (
          <p className="text-sm text-muted-foreground">{t('account.passkeys.disabled')}</p>
        ) : supportResolved && !supported ? (
          <p className="text-sm text-muted-foreground">{t('account.passkeys.unsupported')}</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">{t('account.passkeys.loading')}</p>
        ) : loadError ? (
          <p className="text-sm text-destructive">
            {t('account.passkeys.loadError')}: {loadError}
          </p>
        ) : !passkeys || passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('account.passkeys.empty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('account.passkeys.columnName')}</TableHead>
                  <TableHead>{t('account.passkeys.columnCreated')}</TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {passkeys.map((pk) => (
                  <TableRow key={pk.credentialId}>
                    <TableCell className="font-medium">
                      {pk.friendlyName || (
                        <span className="font-mono text-xs text-muted-foreground">
                          {pk.credentialId.slice(0, 12)}…
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {pk.createdAt ? (
                        <span title={pk.createdAt}>{formatDate(pk.createdAt)}</span>
                      ) : (
                        ''
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleRemove(pk.credentialId)}
                      >
                        {t('account.passkeys.delete')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}
