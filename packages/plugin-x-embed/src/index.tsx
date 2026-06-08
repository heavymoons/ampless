// `@ampless/plugin-x-embed` server entry. Exposes a factory that
// returns the `AmplessPlugin` ampless wires up at `cms.config.ts`:
//
//   import xEmbedPlugin from '@ampless/plugin-x-embed'
//   export default defineConfig({
//     plugins: [xEmbedPlugin()],
//   })
//
// Contributes two `contentFields` renderers (tiptap `amplessTweet`
// node + markdown URL pattern matching x.com / twitter.com /status/
// URLs) and one `publicPostScript` (widgets.js, injected once per
// page when any post on that page actually contains a tweet).

import { definePlugin, type AmplessPlugin } from 'ampless'
import { TweetEmbed, TWEET_URL, hasTweetIn } from './shared.js'

export interface XEmbedPluginOptions {
  /**
   * Override the plugin's `name` (and admin-side namespace). Multi-
   * instance is not currently supported by the contentFields registry.
   */
  name?: string
}

export default function xEmbedPlugin(
  opts: XEmbedPluginOptions = {},
): AmplessPlugin {
  return definePlugin({
    name: opts.name ?? '@ampless/plugin-x-embed',
    apiVersion: 1,
    packageName: '@ampless/plugin-x-embed',
    trust_level: 'trusted',
    capabilities: ['contentFields', 'publicPostScript'],
    displayName: { en: 'x.com (Twitter) embeds', ja: 'x.com (Twitter) 埋め込み' },
    contentFields: [
      {
        kind: 'tiptap',
        nodeType: 'amplessTweet',
        render: (node) => {
          const tweetId = String(node.attrs?.tweetId ?? '')
          return <TweetEmbed tweetId={tweetId} />
        },
      },
      {
        kind: 'markdown-url',
        pattern: TWEET_URL,
        render: ({ match }) => {
          const tweetId = match[1] ?? ''
          return <TweetEmbed tweetId={tweetId} />
        },
      },
    ],
    publicPostScript(post) {
      if (!hasTweetIn(post)) return []
      return [
        {
          id: 'amplessTweet:widgets',
          src: 'https://platform.twitter.com/widgets.js',
          async: true,
        },
      ]
    },
  })
}

export {
  TweetEmbed,
  TWEET_URL,
  parseTweetUrl,
  hasTweetIn,
} from './shared.js'
