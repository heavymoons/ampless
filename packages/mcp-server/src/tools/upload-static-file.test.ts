import { describe, it, expect } from 'vitest'
import { uploadStaticFile } from './upload-static-file.js'
import type { StorageClient } from './types.js'

function makeStorage(): {
  storage: StorageClient
  puts: { key: string; body: Uint8Array; contentType: string }[]
} {
  const puts: { key: string; body: Uint8Array; contentType: string }[] = []
  return {
    storage: {
      async putObject(key, body, contentType) {
        puts.push({ key, body, contentType })
        return `https://test.s3.us-east-1.amazonaws.com/${key}`
      },
      async deleteObject() {},
      async listObjects() {
        return []
      },
    },
    puts,
  }
}

describe('upload_static_file', () => {
  it('uploads a binary file with a derived content-type', async () => {
    const { storage, puts } = makeStorage()
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')

    const result = await uploadStaticFile(storage, {
      slug: 'lp',
      filename: 'img/logo.png',
      base64Data: data,
    })

    expect(puts).toHaveLength(1)
    expect(puts[0]!.key).toBe('public/static/lp/img/logo.png')
    expect(puts[0]!.contentType).toBe('image/png')
    expect(result.size).toBe(4)
  })

  it('respects an explicit contentType override', async () => {
    const { storage, puts } = makeStorage()
    const data = Buffer.from('hello').toString('base64')

    await uploadStaticFile(storage, {
      slug: 'lp',
      filename: 'note.unknown',
      contentType: 'application/x-custom',
      base64Data: data,
    })

    expect(puts[0]!.contentType).toBe('application/x-custom')
  })

  it('rejects bad filenames (parent traversal, absolute paths)', async () => {
    const { storage } = makeStorage()
    await expect(
      uploadStaticFile(storage, {
        slug: 'lp',
        filename: '../etc/passwd',
        base64Data: Buffer.from('x').toString('base64'),
      }),
    ).rejects.toThrow(/parent-directory/i)
    await expect(
      uploadStaticFile(storage, {
        slug: 'lp',
        filename: '/abs',
        base64Data: Buffer.from('x').toString('base64'),
      }),
    ).rejects.toThrow(/absolute/i)
  })

  it('lints HTML for absolute path refs', async () => {
    const { storage } = makeStorage()
    const html = '<img src="/abs.png">'

    await expect(
      uploadStaticFile(storage, {
        slug: 'lp',
        filename: 'index.html',
        base64Data: Buffer.from(html).toString('base64'),
      }),
    ).rejects.toThrow(/absolute/i)
  })

  it('rejects zero-byte uploads', async () => {
    const { storage } = makeStorage()
    await expect(
      uploadStaticFile(storage, {
        slug: 'lp',
        filename: 'index.html',
        base64Data: '',
      }),
    ).rejects.toThrow(/zero bytes/i)
  })

  it('passes a clean HTML file through and uploads it', async () => {
    const { storage, puts } = makeStorage()
    const html = '<a href="other.html">x</a>'

    const result = await uploadStaticFile(storage, {
      slug: 'lp',
      filename: 'about.html',
      base64Data: Buffer.from(html).toString('base64'),
    })

    expect(puts).toHaveLength(1)
    expect(puts[0]!.contentType).toBe('text/html; charset=utf-8')
    expect(result.key).toBe('public/static/lp/about.html')
  })
})
