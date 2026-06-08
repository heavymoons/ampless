'use client'

// `@ampless/plugin-x-embed/editor` — client-side tiptap Node for the
// admin editor. Templates wire this up in `_editor-bootstrap.tsx`
// alongside the YouTube extension; the Node accepts a tweet URL via
// paste rule + `insertTweetFromUrl(url)` command and stores it as
// `{ type: 'amplessTweet', attrs: { tweetId } }` in the tiptap JSON
// doc.
//
// Editor-side rendering is intentionally a lightweight placeholder.
// We do NOT hydrate widgets.js inside the editor because:
//   1. The editor is in the admin same-origin context; loading
//      platform.twitter.com there is unnecessary CSP risk.
//   2. The preview iframe (sandbox=`allow-scripts`) handles the real
//      widget render via `publicPostScript`.

import { Node, mergeAttributes } from '@tiptap/core'
import { parseTweetUrl, TWEET_URL } from './shared.js'

declare module '@tiptap/core' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    amplessTweet: {
      /** Insert a tweet embed node with the given tweet id. */
      setTweet: (opts: { tweetId: string }) => ReturnType
      /**
       * Insert a tweet embed from a URL. Returns false (and does
       * nothing) if the URL doesn't match the canonical x.com /
       * twitter.com /status/ form.
       */
      insertTweetFromUrl: (url: string) => ReturnType
    }
  }
}

export const AmplessTweetNode = Node.create({
  name: 'amplessTweet',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      tweetId: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-tweet-id') ?? '',
        renderHTML: (attrs: Record<string, unknown>) => ({
          'data-tweet-id': String(attrs.tweetId ?? ''),
        }),
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-ampless-tweet]',
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-ampless-tweet': '',
        class: 'ampless-tweet-placeholder',
      }),
      ['span', {}, `Tweet: ${HTMLAttributes['data-tweet-id'] ?? ''}`],
    ]
  },
  addCommands() {
    return {
      setTweet:
        (opts) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { tweetId: opts.tweetId },
          }),
      insertTweetFromUrl:
        (url) =>
        ({ commands }) => {
          const tweetId = parseTweetUrl(url)
          if (!tweetId) return false
          return commands.insertContent({
            type: this.name,
            attrs: { tweetId },
          })
        },
    }
  },
  addPasteRules() {
    return [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({
        find: TWEET_URL,
        handler: ({ range, match, commands }: any) => {
          const tweetId = match[1]
          if (!tweetId) return
          commands.deleteRange(range)
          commands.insertContent({
            type: this.name,
            attrs: { tweetId },
          })
        },
      }) as never,
    ]
  },
})

/**
 * Named export consumed by templates' `_editor-bootstrap.tsx`.
 */
export const tweetEditor = {
  extension: AmplessTweetNode,
}

/**
 * Canonical named export consumed by the codegen'd
 * `_editor-bootstrap.tsx`. Plugins MUST export this symbol from
 * their `./editor` module (= the subpath declared in
 * `package.json#amplessPlugin.editorExports`) for the
 * auto-wiring to find them.
 */
export const editorExtension = AmplessTweetNode
