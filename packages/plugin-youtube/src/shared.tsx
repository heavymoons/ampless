// Shared regex + React component used by both the server-side
// `contentFields` renderer (`./index.tsx`) and the client-side tiptap
// extension (`./editor.tsx`).
//
// Trust note: the renderer only emits a single `<iframe>` element with
// a hard-coded host. The URL is parsed into the 11-char video id and
// re-stringified into the youtube-nocookie embed URL — we never
// interpolate the raw URL into the iframe `src`, so a maliciously
// crafted path can't smuggle additional script tags through.

import type { ReactElement } from 'react'

/**
 * YouTube canonical / short URL pattern. Anchored with `^...$` so the
 * markdown walker only intercepts paragraphs whose entire content is a
 * single YouTube URL.
 *
 * Captures:
 *   - Group 1: video id for `youtube.com/watch?v=<id>`
 *   - Group 2: video id for `youtu.be/<id>`
 *
 * The id grammar `[\w-]{11}` matches the canonical 11-character
 * YouTube video id format. Anything else fails the regex.
 */
export const YOUTUBE_URL =
  /^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=([\w-]{11})|youtu\.be\/([\w-]{11}))(?:[?&#]\S*)?$/

const VIDEO_ID = /^[\w-]{11}$/

export interface YouTubeEmbedProps {
  videoId: string
  /** Start position in seconds. Forwarded to the embed URL as `?start=`. */
  start?: number
  /** Embed title for screen readers / iframe `title`. */
  title?: string
}

/**
 * Render a YouTube embed as a single `<iframe>` pointing at
 * youtube-nocookie.com (the privacy-enhanced embed host that does NOT
 * set cookies until the user starts playback). Defensive: an invalid
 * `videoId` (not matching the 11-char pattern) renders nothing.
 */
export function YouTubeEmbed({
  videoId,
  start,
  title,
}: YouTubeEmbedProps): ReactElement | null {
  if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) return null
  const query =
    typeof start === 'number' && Number.isFinite(start) && start > 0
      ? `?start=${Math.floor(start)}`
      : ''
  const src = `https://www.youtube-nocookie.com/embed/${videoId}${query}`
  return (
    <iframe
      src={src}
      title={title ?? `YouTube video ${videoId}`}
      loading="lazy"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      width={560}
      height={315}
      style={{ width: '100%', aspectRatio: '16 / 9', height: 'auto', border: 0 }}
    />
  )
}

/**
 * Extract the 11-char video id from a URL string. Returns `null` if the
 * URL doesn't match the canonical / short form. Used by the tiptap
 * editor's paste rule + the `contentFields` markdown walker.
 */
export function parseYoutubeUrl(url: string): string | null {
  const trimmed = url.trim()
  const m = trimmed.match(YOUTUBE_URL)
  if (!m) return null
  return m[1] ?? m[2] ?? null
}
