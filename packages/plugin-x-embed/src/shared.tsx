// Shared regex + React component used by both the server-side
// `contentFields` renderer (`./index.tsx`) and the client-side tiptap
// extension (`./editor.tsx`).
//
// Trust note: the renderer emits the canonical
// `<blockquote class="twitter-tweet">` pattern documented by
// developer.x.com. Widgets.js (loaded via `publicPostScript`) hydrates
// it into the embedded card. We never interpolate the raw user URL
// into the markup — only the validated tweet id, used to construct
// the canonical Twitter URL.

import type { ReactElement } from 'react'

/**
 * Tweet URL pattern. Accepts both `x.com` and `twitter.com` hosts, any
 * valid handle (1-15 chars, [A-Za-z0-9_]), and a numeric status id
 * (1-25 digits — far above any actual real tweet id but safely capped
 * to prevent overflow / abuse). Anchored with `^...$` so the markdown
 * walker only intercepts single-URL paragraphs.
 *
 * Captures:
 *   - Group 1: tweet status id
 */
export const TWEET_URL =
  /^https:\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,25})(?:[?&#]\S*)?$/

const TWEET_ID = /^\d{1,25}$/

export interface TweetEmbedProps {
  tweetId: string
}

/**
 * Render a tweet as a `<blockquote class="twitter-tweet">` with a link
 * to the canonical twitter.com URL. Widgets.js (injected via the
 * plugin's `publicPostScript`) finds blockquotes with this class on
 * page load and replaces them with the rich embed card.
 *
 * Defensive: an invalid `tweetId` (not matching the numeric pattern)
 * renders nothing.
 */
export function TweetEmbed({ tweetId }: TweetEmbedProps): ReactElement | null {
  if (typeof tweetId !== 'string' || !TWEET_ID.test(tweetId)) return null
  return (
    <blockquote className="twitter-tweet" data-dnt="true">
      <a href={`https://twitter.com/i/status/${tweetId}`} />
    </blockquote>
  )
}

/**
 * Extract the tweet id from a URL string. Returns `null` if the URL
 * doesn't match the canonical x.com / twitter.com status form. Used
 * by the tiptap editor's paste rule + the `contentFields` markdown
 * walker + `hasTweetIn`.
 */
export function parseTweetUrl(url: string): string | null {
  const trimmed = url.trim()
  const m = trimmed.match(TWEET_URL)
  if (!m) return null
  return m[1] ?? null
}

/**
 * Scan a post body for any tweet embed. Used by the plugin's
 * `publicPostScript` to decide whether widgets.js is actually needed
 * for a given page — pages with no tweets don't pay for the script
 * round trip.
 */
export function hasTweetIn(post: {
  format?: string
  body?: unknown
}): boolean {
  if (post.format === 'tiptap') {
    return hasTweetNodeInTiptap(post.body)
  }
  if (post.format === 'markdown') {
    if (typeof post.body !== 'string') return false
    return hasTweetUrlInMarkdown(post.body)
  }
  if (post.format === 'html') {
    if (typeof post.body !== 'string') return false
    // `twitter-tweet`: a hand-written `<blockquote class="twitter-tweet">`.
    // `data-ampless-tweet`: the canonical placeholder div the admin's
    // tiptap→html switch emits — the public html walker expands it into a
    // `<blockquote class="twitter-tweet">` at render time, so widgets.js
    // must be injected for that hydration to happen.
    return (
      post.body.includes('twitter-tweet') ||
      post.body.includes('data-ampless-tweet')
    )
  }
  return false
}

function hasTweetNodeInTiptap(body: unknown): boolean {
  // String body — defensive path matches the runtime's `tiptap` save
  // edge case (format switch save). Fall through to markdown scan.
  if (typeof body === 'string') return body.includes('twitter-tweet')
  if (!body || typeof body !== 'object') return false
  const node = body as { type?: string; content?: unknown[] }
  if (node.type === 'amplessTweet') return true
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (hasTweetNodeInTiptap(child)) return true
    }
  }
  return false
}

function hasTweetUrlInMarkdown(md: string): boolean {
  // Line-scan: any line whose trimmed content matches TWEET_URL marks
  // the post as containing an embed. Cheap, doesn't require pulling in
  // marked.lexer just for the detection pass.
  for (const line of md.split(/\r?\n/)) {
    if (TWEET_URL.test(line.trim())) return true
  }
  return false
}
