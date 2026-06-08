import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { YouTubeEmbed, YOUTUBE_URL, parseYoutubeUrl } from './shared.js'

describe('YOUTUBE_URL pattern', () => {
  it('matches the canonical watch URL', () => {
    const m = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'.match(YOUTUBE_URL)
    expect(m).not.toBeNull()
    expect(m?.[1]).toBe('dQw4w9WgXcQ')
  })

  it('matches the short youtu.be URL', () => {
    const m = 'https://youtu.be/dQw4w9WgXcQ'.match(YOUTUBE_URL)
    expect(m).not.toBeNull()
    expect(m?.[2]).toBe('dQw4w9WgXcQ')
  })

  it('rejects http (non-https)', () => {
    expect('http://youtu.be/dQw4w9WgXcQ'.match(YOUTUBE_URL)).toBeNull()
  })

  it('rejects ids shorter than 11 chars', () => {
    expect('https://youtu.be/short'.match(YOUTUBE_URL)).toBeNull()
  })

  it('rejects when extra path appended', () => {
    expect('https://youtu.be/dQw4w9WgXcQ/extra'.match(YOUTUBE_URL)).toBeNull()
  })

  it('accepts trailing query string', () => {
    expect('https://youtu.be/dQw4w9WgXcQ?t=30'.match(YOUTUBE_URL)).not.toBeNull()
  })
})

describe('parseYoutubeUrl', () => {
  it('extracts the id from a watch URL', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    )
  })

  it('returns null for non-matching URLs', () => {
    expect(parseYoutubeUrl('https://example.com')).toBeNull()
  })

  it('trims whitespace', () => {
    expect(parseYoutubeUrl('  https://youtu.be/dQw4w9WgXcQ  ')).toBe(
      'dQw4w9WgXcQ',
    )
  })
})

describe('YouTubeEmbed component', () => {
  it('renders an iframe with youtube-nocookie.com src', () => {
    const html = renderToStaticMarkup(
      <YouTubeEmbed videoId="dQw4w9WgXcQ" />,
    )
    expect(html).toContain('youtube-nocookie.com')
    expect(html).toContain('dQw4w9WgXcQ')
    expect(html).toContain('loading="lazy"')
  })

  it('appends ?start= when start is positive', () => {
    const html = renderToStaticMarkup(
      <YouTubeEmbed videoId="dQw4w9WgXcQ" start={30} />,
    )
    expect(html).toContain('start=30')
  })

  it('renders nothing for invalid video id', () => {
    const html = renderToStaticMarkup(
      <YouTubeEmbed videoId="bad" />,
    )
    expect(html).toBe('')
  })
})
