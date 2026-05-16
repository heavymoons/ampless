import type { Post } from './types.js'

/**
 * Extract the first image URL from a post body. Used by plugins (e.g.
 * plugin-og-image) that want to derive an image from the post content
 * without requiring authors to set an explicit featured image field.
 *
 * Returns null if the post has no image, or if the body shape doesn't
 * match the declared `post.format`.
 *
 * Format handling:
 *  - 'tiptap'   — body is the tiptap JSON tree; walks for `type === 'image'`
 *  - 'markdown' — body is a string; finds the first `![alt](src)`
 *  - 'html'     — body is a string; finds the first `<img src="...">`
 */
export function extractFirstImageUrl(post: Post): string | null {
  switch (post.format) {
    case 'tiptap':
      return findTiptapImage(post.body)
    case 'markdown':
      return findMarkdownImage(post.body)
    case 'html':
      return findHtmlImage(post.body)
    default:
      return null
  }
}

interface TiptapNode {
  type?: string
  attrs?: Record<string, unknown>
  content?: unknown
}

function findTiptapImage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const node = body as TiptapNode

  if (node.type === 'image') {
    const src = node.attrs?.src
    if (typeof src === 'string' && src.length > 0) return src
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const hit = findTiptapImage(child)
      if (hit) return hit
    }
  }

  return null
}

function findMarkdownImage(body: unknown): string | null {
  if (typeof body !== 'string') return null
  const m = body.match(/!\[[^\]]*\]\(([^)]+)\)/)
  return m ? m[1] : null
}

function findHtmlImage(body: unknown): string | null {
  if (typeof body !== 'string') return null
  const m = body.match(/<img[^>]+src=["']([^"']+)["']/i)
  return m ? m[1] : null
}
