import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { definePlugin, type Post } from 'ampless'
import { createPluginHead } from './plugin-head.js'
import type { PluginSettingsApi, PluginSettingsSnapshot } from './plugin-settings.js'

function makePluginSettings(): PluginSettingsApi {
  return {
    loadAll: async () =>
      ({
        get: () => undefined,
      } as unknown as PluginSettingsSnapshot),
  } as PluginSettingsApi
}

function makePost(id: string, slug: string): Post {
  return {
    postId: id,
    slug,
    title: slug,
    format: 'markdown',
    body: '',
    status: 'published',
    tags: [],
  }
}

describe('publicPostScriptsForPage', () => {
  it('dedupes by stable id across multiple posts', async () => {
    const tweetPlugin = definePlugin({
      name: 'tweet-test',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicPostScript'],
      publicPostScript: () => [
        {
          id: 'amplessTweet:widgets',
          src: 'https://platform.twitter.com/widgets.js',
          async: true,
        },
      ],
    })
    const head = createPluginHead(
      {
        site: { name: 'X', url: 'https://x.example.com' },
        plugins: [tweetPlugin],
      },
      makePluginSettings(),
    )
    const node = await head.renderPostScriptsForPage([
      makePost('1', 'a'),
      makePost('2', 'b'),
      makePost('3', 'c'),
    ])
    const html = renderToStaticMarkup(node as React.ReactElement)
    // widgets.js appears exactly once even though three posts emit it.
    const occurrences = (html.match(/widgets\.js/g) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('drops descriptors with empty id and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = definePlugin({
      name: 'bad-test',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicPostScript'],
      publicPostScript: () => [
        {
          id: '',
          src: 'https://example.com/foo.js',
        },
      ],
    })
    const head = createPluginHead(
      { site: { name: 'X', url: 'https://x.example.com' }, plugins: [bad] },
      makePluginSettings(),
    )
    const node = await head.renderPostScriptsForPage([makePost('1', 'a')])
    expect(node).toBeNull()
    warn.mockRestore()
  })

  it('drops descriptors with unsafe (non-http/https) src', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = definePlugin({
      name: 'bad-src',
      apiVersion: 1,
      trust_level: 'untrusted',
      capabilities: ['publicPostScript'],
      publicPostScript: () => [
        {
          id: 'x',
          src: 'javascript:alert(1)',
        },
      ],
    })
    const head = createPluginHead(
      { site: { name: 'X', url: 'https://x.example.com' }, plugins: [bad] },
      makePluginSettings(),
    )
    const node = await head.renderPostScriptsForPage([makePost('1', 'a')])
    expect(node).toBeNull()
    warn.mockRestore()
  })

  it('returns null when no plugin provides scripts', async () => {
    const head = createPluginHead(
      { site: { name: 'X', url: 'https://x.example.com' }, plugins: [] },
      makePluginSettings(),
    )
    const node = await head.renderPostScriptsForPage([makePost('1', 'a')])
    expect(node).toBeNull()
  })
})
