'use client'

import { useEffect, useState } from 'react'
import { generateClient } from 'aws-amplify/api'
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

// Schema lives in the host template (templates/_shared/amplify/data),
// so admin can't import a typed `generateClient<Schema>()`. Mirror the
// kv-provider pattern: cast the loose generateClient() return shape to
// a hand-typed interface that covers exactly the ops we hit.

type AdminRole = 'admin' | 'editor' | 'none'

interface AdminUser {
  userId: string
  email: string
  role: AdminRole
}

interface GraphQLResult<T> {
  data: T | null
  errors?: Array<{ message?: string }> | null
}

interface UserAdminClient {
  queries: {
    listAdminUsers: () => Promise<GraphQLResult<AdminUser[]>>
  }
  mutations: {
    setAdminUserRole: (args: {
      userId: string
      role: AdminRole
    }) => Promise<GraphQLResult<AdminUser>>
  }
}

function isAdminRole(value: string): value is AdminRole {
  return value === 'admin' || value === 'editor' || value === 'none'
}

interface RowState {
  selected: AdminRole
  saving: boolean
  error: string | null
}

export function UsersListView({ currentUserId }: { currentUserId: string }) {
  const t = useT()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, RowState>>({})

  useEffect(() => {
    const client = generateClient() as unknown as UserAdminClient
    client.queries
      .listAdminUsers()
      .then(({ data, errors }) => {
        if (errors && errors.length > 0) {
          const msg = errors[0]?.message ?? 'listAdminUsers failed'
          console.error('[users-list-view] listAdminUsers errors:', errors)
          setLoadError(msg)
          return
        }
        const list = data ?? []
        setUsers(list)
        setRows(
          Object.fromEntries(
            list.map((u) => [u.userId, { selected: u.role, saving: false, error: null }])
          )
        )
      })
      .catch((err: unknown) => {
        console.error('[users-list-view] listAdminUsers threw:', err)
        setLoadError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoading(false))
  }, [])

  function updateRow(userId: string, patch: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], ...patch },
    }))
  }

  async function save(userId: string) {
    const row = rows[userId]
    if (!row) return
    updateRow(userId, { saving: true, error: null })
    try {
      const client = generateClient() as unknown as UserAdminClient
      const { data, errors } = await client.mutations.setAdminUserRole({
        userId,
        role: row.selected,
      })
      if (errors && errors.length > 0) {
        const msg = errors[0]?.message ?? 'setAdminUserRole failed'
        console.error('[users-list-view] setAdminUserRole errors:', errors)
        updateRow(userId, { saving: false, error: msg })
        return
      }
      if (data) {
        setUsers((prev) =>
          (prev ?? []).map((u) => (u.userId === userId ? data : u))
        )
        updateRow(userId, { saving: false, selected: data.role, error: null })
      } else {
        updateRow(userId, { saving: false })
      }
    } catch (err) {
      console.error('[users-list-view] setAdminUserRole threw:', err)
      updateRow(userId, {
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl font-bold md:text-3xl">{t('users.list.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('users.list.description')}</p>
      </div>

      {loading ? (
        <p className="text-muted-foreground">{t('users.list.loading')}</p>
      ) : loadError ? (
        <p className="text-sm text-destructive">
          {t('users.list.error')}: {loadError}
        </p>
      ) : !users || users.length === 0 ? (
        <p className="text-muted-foreground">{t('users.list.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('users.list.columnEmail')}</TableHead>
                <TableHead>{t('users.list.columnRole')}</TableHead>
                <TableHead className="w-[1%] whitespace-nowrap">
                  {t('users.list.columnActions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const row = rows[u.userId]
                if (!row) return null
                const isSelf = u.userId === currentUserId
                const dirty = row.selected !== u.role
                return (
                  <TableRow key={u.userId}>
                    <TableCell className="font-medium">{u.email || u.userId}</TableCell>
                    <TableCell>
                      <select
                        className="rounded-md border bg-background px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                        value={row.selected}
                        disabled={isSelf || row.saving}
                        onChange={(e) => {
                          const next = e.target.value
                          if (isAdminRole(next)) {
                            updateRow(u.userId, { selected: next })
                          }
                        }}
                      >
                        <option value="admin">{t('users.list.roleAdmin')}</option>
                        <option value="editor">{t('users.list.roleEditor')}</option>
                        <option value="none">{t('users.list.roleNone')}</option>
                      </select>
                      {isSelf && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('users.list.cannotEditSelf')}
                        </p>
                      )}
                      {row.error && (
                        <p className="mt-1 text-xs text-destructive">{row.error}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        disabled={isSelf || row.saving || !dirty}
                        onClick={() => save(u.userId)}
                      >
                        {row.saving ? t('users.list.saving') : t('users.list.save')}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
