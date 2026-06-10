import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  TweetEmbed,
  TWEET_URL,
  parseTweetUrl,
  hasTweetIn,
} from './shared.js'

describe('TWEET_URL pattern', () => {
  it('matches x.com /status/ URL', () => {
    const m = 'https://x.com/jack/status/20'.match(TWEET_URL)
    expect(m).not.toBeNull()
    expect(m?.[1]).toBe('20')
  })

  it('matches twitter.com /status/ URL', () => {
    const m =
      'https://twitter.com/jack/status/1234567890123456789'.match(TWEET_URL)
    expect(m).not.toBeNull()
    expect(m?.[1]).toBe('1234567890123456789')
  })

  it('rejects non-numeric status id', () => {
    expect('https://x.com/jack/status/abc'.match(TWEET_URL)).toBeNull()
  })

  it('rejects extra path after status id', () => {
    expect('https://x.com/jack/status/20/photo'.match(TWEET_URL)).toBeNull()
  })

  it('accepts trailing query string', () => {
    expect('https://x.com/jack/status/20?s=46'.match(TWEET_URL)).not.toBeNull()
  })

  it('rejects http (non-https)', () => {
    expect('http://x.com/jack/status/20'.match(TWEET_URL)).toBeNull()
  })
})

describe('parseTweetUrl', () => {
  it('extracts the id from a /status/ URL', () => {
    expect(parseTweetUrl('https://x.com/jack/status/20')).toBe('20')
  })
  it('returns null for non-matching URLs', () => {
    expect(parseTweetUrl('https://example.com')).toBeNull()
  })
})

describe('TweetEmbed component', () => {
  it('renders a twitter-tweet blockquote', () => {
    const html = renderToStaticMarkup(<TweetEmbed tweetId="20" />)
    expect(html).toContain('twitter-tweet')
    expect(html).toContain('twitter.com/i/status/20')
  })

  it('renders nothing for non-numeric id', () => {
    const html = renderToStaticMarkup(<TweetEmbed tweetId="bad" />)
    expect(html).toBe('')
  })
})

describe('hasTweetIn', () => {
  it('detects a tweet URL in markdown', () => {
    expect(
      hasTweetIn({
        format: 'markdown',
        body: 'hello\n\nhttps://x.com/jack/status/20\n\nbye',
      }),
    ).toBe(true)
  })

  it('returns false for markdown without tweet URL', () => {
    expect(hasTweetIn({ format: 'markdown', body: 'no tweets here' })).toBe(false)
  })

  it('detects an amplessTweet node in tiptap doc', () => {
    expect(
      hasTweetIn({
        format: 'tiptap',
        body: {
          type: 'doc',
          content: [{ type: 'amplessTweet', attrs: { tweetId: '20' } }],
        },
      }),
    ).toBe(true)
  })

  it('returns false for empty tiptap doc', () => {
    expect(
      hasTweetIn({
        format: 'tiptap',
        body: { type: 'doc', content: [{ type: 'paragraph' }] },
      }),
    ).toBe(false)
  })

  it('detects twitter-tweet class in html format', () => {
    expect(
      hasTweetIn({
        format: 'html',
        body: '<blockquote class="twitter-tweet"></blockquote>',
      }),
    ).toBe(true)
  })

  it('detects a data-ampless-tweet placeholder div in html format', () => {
    // The public html walker expands this into a twitter-tweet blockquote,
    // so widgets.js must be injected for it to hydrate.
    expect(
      hasTweetIn({
        format: 'html',
        body: '<div data-ampless-tweet data-tweet-id="20"><a href="https://twitter.com/i/status/20">20</a></div>',
      }),
    ).toBe(true)
  })

  it('returns false for plain html without a tweet placeholder', () => {
    expect(
      hasTweetIn({
        format: 'html',
        body: '<p>just some prose, no embeds</p>',
      }),
    ).toBe(false)
  })

  it('returns false for a [caption](url) markdown link', () => {
    expect(
      hasTweetIn({
        format: 'markdown',
        body: '[watch this](https://x.com/jack/status/20)',
      }),
    ).toBe(false)
  })

  it('returns true for a bare tweet URL line', () => {
    expect(
      hasTweetIn({
        format: 'markdown',
        body: 'before\n\nhttps://x.com/jack/status/20\n\nafter',
      }),
    ).toBe(true)
  })
})
