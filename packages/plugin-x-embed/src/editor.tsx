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
//   2. The preview iframe (sandbox=`allow-scripts allow-same-origin`,
//      v1 trust boundary expansion) handles the real widget render via
//      `publicPostScript` — widgets.js hydrates there because it gets a
//      real origin (= the admin's) rather than an opaque origin.

import { Node, mergeAttributes } from '@tiptap/core'
import { parseTweetUrl, TWEET_URL } from './shared.js'

function getBareUrlLinkHref(el: HTMLElement): string | null {
  if (el.tagName.toLowerCase() === 'a') {
    return el.getAttribute('href')
  }

  if (el.tagName.toLowerCase() !== 'p') return null
  const children = Array.from(el.children)
  if (children.length !== 1) return null

  const link = children[0]
  if (!(link instanceof HTMLElement)) return null
  if (link.tagName.toLowerCase() !== 'a') return null

  const href = link.getAttribute('href')?.trim()
  if (!href) return null

  const linkText = link.textContent?.trim()
  if (linkText !== href) return null
  if (el.textContent?.trim() !== linkText) return null

  return href
}

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
        parseHTML: (el: HTMLElement) => {
          const dataTweetId = el.getAttribute('data-tweet-id')
          if (dataTweetId != null) return dataTweetId

          // Defensive fallback for the `tag: 'div[data-ampless-tweet]'`
          // self-render rule. That rule has no `getAttrs`, so tiptap consults
          // this addAttributes.parseHTML — and the higher-priority `tag: 'p'`
          // / `tag: 'a[href]'` rules already have their own getAttrs so they
          // don't reach here. If the malformed `<div data-ampless-tweet>`
          // somehow lost its `data-tweet-id` (e.g. a downstream HTML sanitiser
          // stripped data-* attrs but left the tag) we try to recover the id
          // from a bare URL link inside it. Normal happy-path HTML never hits
          // this branch.
          const href = getBareUrlLinkHref(el)
          return href ? (parseTweetUrl(href) ?? '') : ''
        },
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
      {
        tag: 'p',
        priority: 100,
        getAttrs: (el) => {
          const href = getBareUrlLinkHref(el as HTMLElement) ?? ''
          const tweetId = parseTweetUrl(href)
          if (!tweetId) return false
          return { tweetId }
        },
      },
      {
        // Bare-URL `<a>` standalone (outside a single-link `<p>`). Mirrors the
        // markdown-side `extractSingleUrl` rule from PR #258: only intercept
        // when the link's visible text equals its href — `[caption](url)` /
        // `<a href="https://x.com/.../status/...">caption</a>` should stay a
        // normal captioned Link, not silently swallow the caption into an embed.
        tag: 'a[href]',
        priority: 100,
        getAttrs: (el) => {
          const link = el as HTMLElement
          const href = link.getAttribute('href')?.trim() ?? ''
          if (!href) return false
          const linkText = link.textContent?.trim() ?? ''
          if (linkText !== href) return false
          const tweetId = parseTweetUrl(href)
          if (!tweetId) return false
          return { tweetId }
        },
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
        // tiptap's paste rule internally calls `String.prototype.matchAll`
        // which throws when the regex doesn't carry the `g` flag. Clone
        // the source regex (which is anchored `^...$` for use in the
        // renderer / markdown extractor) into a global form here. Anchored
        // global is fine — without the `m` flag, `^...$` only anchor at the
        // start / end of the **entire input**, so this matches at most
        // once for the pasted input as a whole (= exactly the single-URL
        // paste case we care about).
        find: new RegExp(TWEET_URL.source, 'g'),
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

import type { TiptapNodeMarkdownAdapters } from 'ampless'

/**
 * tiptap → markdown adapter map. Serialises `amplessTweet` nodes back
 * to a bare `https://x.com/i/status/<tweetId>` URL line so the admin's
 * "format: tiptap → markdown" body switch is lossless. The URL form
 * uses `i` as the handle — confirmed to match the existing `TWEET_URL`
 * regex (`/[A-Za-z0-9_]{1,15}/`). The reverse direction (URL → embed
 * node on paste) is handled by the existing paste rule + `extractSingleUrl`
 * path in the runtime.
 *
 * `update-ampless` reads this export (via namespace import `* as`) and
 * wires it into `installAdminTiptapNodeMarkdown`.
 */
export const tiptapNodeToMarkdown: TiptapNodeMarkdownAdapters = {
  amplessTweet: (node) => {
    const tweetId = String(node.attrs?.tweetId ?? '').trim()
    if (!tweetId) return null
    return `https://x.com/i/status/${tweetId}`
  },
}
