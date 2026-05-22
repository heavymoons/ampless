import { describe, it, expect } from 'vitest'
import { deleteStaticFile } from './delete-static-file.js'
import type { StorageClient, StorageObject } from './types.js'

function makeStorage(initial: StorageObject[] = []): {
  storage: StorageClient
  deletes: string[]
} {
  const deletes: string[] = []
  let items = [...initial]
  return {
    storage: {
      async putObject(key) {
        return key
      },
      async deleteObject(key) {
        deletes.push(key)
        items = items.filter((o) => o.key !== key)
      },
      async listObjects(prefix) {
        return items.filter((o) => o.key.startsWith(prefix))
      },
    },
    deletes,
  }
}

describe('delete_static_file', () => {
  it('deletes an existing file', async () => {
    const { storage, deletes } = makeStorage([
      { key: 'public/static/lp/index.html', size: 100 },
    ])

    const result = await deleteStaticFile(storage, {
      slug: 'lp',
      filename: 'index.html',
    })

    expect(result.deleted).toBe(true)
    expect(deletes).toEqual(['public/static/lp/index.html'])
  })

  it('returns deleted: false (and skips deleteObject) when the file is missing', async () => {
    const { storage, deletes } = makeStorage([])

    const result = await deleteStaticFile(storage, {
      slug: 'lp',
      filename: 'missing.html',
    })

    expect(result.deleted).toBe(false)
    expect(deletes).toEqual([])
  })

  it('rejects bad filenames', async () => {
    const { storage } = makeStorage()
    await expect(
      deleteStaticFile(storage, {
        slug: 'lp',
        filename: '../escape',
      }),
    ).rejects.toThrow(/parent-directory/i)
  })
})
