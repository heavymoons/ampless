import { describe, it, expect } from 'vitest'
import { uploadMedia } from './upload-media.js'
import type { GraphqlClient, StorageClient } from './types.js'

const graphql: GraphqlClient = {
  async query<T>(): Promise<T> {
    return {
      createMedia: {
        mediaId: 'media-1',
        src: 'public/media/x.png',
        mimeType: 'image/png',
        size: 1,
        delivery: 'nextjs',
        metadata: null,
      },
    } as unknown as T
  },
}

const storage: StorageClient = {
  async putObject(key) {
    return { url: key }
  },
  async deleteObject() {},
  async listObjects() {
    return []
  },
  publicUrl(key) {
    return key
  },
}

const args = (mimeType: string) => ({
  filename: 'x.png',
  mimeType,
  base64Data: Buffer.from('hello').toString('base64'),
})

describe('upload_media mimeType validation', () => {
  it('accepts a normal image type', async () => {
    const r = await uploadMedia(graphql, storage, args('image/png'))
    expect(r.media.mediaId).toBe('media-1')
  })

  it('rejects active-content types served from the public bucket', async () => {
    await expect(uploadMedia(graphql, storage, args('text/html'))).rejects.toThrow(/not allowed/)
    await expect(uploadMedia(graphql, storage, args('application/javascript'))).rejects.toThrow(
      /not allowed/
    )
  })

  it('rejects malformed mimeType strings', async () => {
    await expect(uploadMedia(graphql, storage, args('not-a-mime'))).rejects.toThrow(/invalid mimeType/)
    await expect(uploadMedia(graphql, storage, args(''))).rejects.toThrow(/invalid mimeType/)
  })
})
