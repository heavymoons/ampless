// Tests for packages/admin/src/lib/passkey-store.ts
//
// Two surfaces:
//   1. The injectable registry (setPasskeyApi / getPasskeyApi) — the
//      account view talks to whatever is installed, so an in-memory fake
//      drives the view's logic without DOM / Cognito.
//   2. The default Amplify-backed implementation's normalisation: it
//      pages the credential list, drops entries without a credentialId,
//      converts createdAt Dates to ISO strings, and sorts newest-first.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the three Amplify auth APIs the default impl wraps so the module
// imports cleanly and we can assert on the normalisation path.
const associateMock = vi.hoisted(() => vi.fn())
const listMock = vi.hoisted(() => vi.fn())
const deleteMock = vi.hoisted(() => vi.fn())
vi.mock('aws-amplify/auth', () => ({
  associateWebAuthnCredential: associateMock,
  listWebAuthnCredentials: listMock,
  deleteWebAuthnCredential: deleteMock,
}))

import {
  getPasskeyApi,
  setPasskeyApi,
  type PasskeyApi,
  type PasskeyCredential,
} from './passkey-store.js'

// Capture the default impl before any test overrides it, so the
// normalisation tests can exercise the real wrapper.
const defaultApi = getPasskeyApi()

beforeEach(() => {
  associateMock.mockReset()
  listMock.mockReset()
  deleteMock.mockReset()
  setPasskeyApi(defaultApi)
})

// ---------------------------------------------------------------------------
// Injectable in-memory fake (the pattern the view tests would use)
// ---------------------------------------------------------------------------

function makeInMemoryApi(): PasskeyApi {
  const db = new Map<string, PasskeyCredential>()
  let counter = 0
  return {
    async register() {
      counter += 1
      const id = `cred-${counter}`
      db.set(id, {
        credentialId: id,
        friendlyName: `Passkey ${counter}`,
        createdAt: new Date(Date.now() + counter * 1000).toISOString(),
      })
    },
    async list() {
      return Array.from(db.values())
    },
    async remove(credentialId) {
      db.delete(credentialId)
    },
  }
}

describe('injectable passkey api', () => {
  it('register / list / remove round-trip through the installed api', async () => {
    setPasskeyApi(makeInMemoryApi())
    const api = getPasskeyApi()

    expect(await api.list()).toEqual([])

    await api.register()
    await api.register()
    let list = await api.list()
    expect(list).toHaveLength(2)

    await api.remove(list[0]!.credentialId)
    list = await api.list()
    expect(list).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Default Amplify-backed implementation: normalisation
// ---------------------------------------------------------------------------

describe('default passkey api normalisation', () => {
  it('register delegates to associateWebAuthnCredential', async () => {
    associateMock.mockResolvedValue(undefined)
    await defaultApi.register()
    expect(associateMock).toHaveBeenCalledOnce()
  })

  it('remove delegates to deleteWebAuthnCredential with the credentialId', async () => {
    deleteMock.mockResolvedValue(undefined)
    await defaultApi.remove('cred-xyz')
    expect(deleteMock).toHaveBeenCalledWith({ credentialId: 'cred-xyz' })
  })

  it('drops entries without a credentialId and converts createdAt to ISO', async () => {
    const created = new Date('2026-01-02T03:04:05.000Z')
    listMock.mockResolvedValue({
      credentials: [
        {
          credentialId: 'good',
          friendlyCredentialName: 'My phone',
          createdAt: created,
        },
        // No credentialId — must be dropped (can't be deleted/displayed).
        {
          credentialId: undefined,
          friendlyCredentialName: 'orphan',
          createdAt: created,
        },
      ],
    })

    const list = await defaultApi.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual({
      credentialId: 'good',
      friendlyName: 'My phone',
      createdAt: '2026-01-02T03:04:05.000Z',
    })
  })

  it('normalises a missing createdAt to null', async () => {
    listMock.mockResolvedValue({
      credentials: [
        { credentialId: 'a', friendlyCredentialName: undefined, createdAt: undefined },
      ],
    })
    const list = await defaultApi.list()
    expect(list[0]!.createdAt).toBeNull()
    expect(list[0]!.friendlyName).toBeUndefined()
  })

  it('follows nextToken to page the full list', async () => {
    listMock
      .mockResolvedValueOnce({
        credentials: [{ credentialId: 'p1', friendlyCredentialName: 'one', createdAt: undefined }],
        nextToken: 'tok-2',
      })
      .mockResolvedValueOnce({
        credentials: [{ credentialId: 'p2', friendlyCredentialName: 'two', createdAt: undefined }],
      })

    const list = await defaultApi.list()
    expect(list.map((c) => c.credentialId).sort()).toEqual(['p1', 'p2'])
    // First call has no token, second passes the nextToken.
    expect(listMock).toHaveBeenNthCalledWith(1, undefined)
    expect(listMock).toHaveBeenNthCalledWith(2, { nextToken: 'tok-2' })
  })

  it('sorts newest-first by createdAt, undated entries last', async () => {
    listMock.mockResolvedValue({
      credentials: [
        { credentialId: 'old', friendlyCredentialName: 'o', createdAt: new Date('2026-01-01T00:00:00Z') },
        { credentialId: 'undated', friendlyCredentialName: 'u', createdAt: undefined },
        { credentialId: 'new', friendlyCredentialName: 'n', createdAt: new Date('2026-06-01T00:00:00Z') },
      ],
    })
    const list = await defaultApi.list()
    expect(list.map((c) => c.credentialId)).toEqual(['new', 'old', 'undated'])
  })
})
