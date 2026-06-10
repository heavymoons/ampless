// `@ampless/plugin-youtube` server entry. Exposes a factory that
// returns the `AmplessPlugin` ampless wires up at `cms.config.ts`:
//
//   import youtubePlugin from '@ampless/plugin-youtube'
//   export default defineConfig({
//     plugins: [youtubePlugin()],
//   })
//
// The plugin contributes two `contentFields` renderers — one for the
// tiptap `amplessYoutube` node (rich-text editor flow), one for the
// `youtu.be` / `youtube.com/watch?v=...` URL pattern (markdown
// single-line URL flow). Both render the same `<YouTubeEmbed>` React
// component to keep behaviour identical across content formats.
//
// No `publicPostScript` — YouTube embeds load their own iframe and
// don't need a page-level script injection. (Compare `plugin-x-embed`,
// which does need widgets.js).

import { definePlugin, type AmplessPlugin } from 'ampless'
import { YouTubeEmbed, YOUTUBE_URL } from './shared.js'

export interface YoutubePluginOptions {
  /**
   * Override the plugin's `name` (and therefore admin-side namespace).
   * Useful if a site wants to install two instances or rename the
   * default — though multi-instance is not currently supported by the
   * contentFields registry.
   */
  name?: string
}

export default function youtubePlugin(
  opts: YoutubePluginOptions = {},
): AmplessPlugin {
  return definePlugin({
    name: opts.name ?? 'youtube',
    apiVersion: 1,
    packageName: '@ampless/plugin-youtube',
    trust_level: 'trusted',
    capabilities: ['contentFields'],
    displayName: { en: 'YouTube embeds', ja: 'YouTube 埋め込み' },
    contentFields: [
      {
        kind: 'tiptap',
        nodeType: 'amplessYoutube',
        render: (node) => {
          const videoId = String(node.attrs?.videoId ?? '')
          const startRaw = node.attrs?.start
          const start =
            typeof startRaw === 'number' && Number.isFinite(startRaw)
              ? startRaw
              : undefined
          return <YouTubeEmbed videoId={videoId} start={start} />
        },
        // Opt into the public html walker so `format: 'html'` posts expand
        // the canonical placeholder div (emitted by the admin's tiptap→html
        // switch) into the same `<YouTubeEmbed>` the tiptap / markdown
        // walkers render. Attribute names match `placeholderAttrs()` in
        // ./editor.tsx (the canonical definition site).
        htmlPlaceholder: {
          flagAttr: 'data-ampless-youtube',
          attrsFromElement: (attribs) => {
            // `render` requires `typeof start === 'number'`; the HTML attr
            // is a string, so coerce it here (the walker is type-agnostic).
            const start = Number(attribs['data-start'])
            return {
              videoId: attribs['data-video-id'] ?? '',
              start: Number.isFinite(start) ? start : undefined,
            }
          },
        },
      },
      {
        kind: 'markdown-url',
        pattern: YOUTUBE_URL,
        render: ({ match }) => {
          const videoId = match[1] ?? match[2] ?? ''
          return <YouTubeEmbed videoId={videoId} />
        },
      },
    ],
  })
}

export { YouTubeEmbed, YOUTUBE_URL, parseYoutubeUrl } from './shared.js'
