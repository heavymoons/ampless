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

/**
 * Returns the canonical flat attribute dictionary for a tweet embed
 * placeholder div. Used by both `Node.renderHTML` (consumed via
 * `mergeAttributes` → DOMOutputSpec array) and `tiptapNodeToHtml`
 * (HTML-encoded into a `<div ...>` string). Single source of truth for
 * the attribute set the parseHTML `tag: 'div[data-ampless-tweet]'`
 * rule restores from.
 */
function placeholderAttrs(attrs: { tweetId?: unknown }): Record<string, string> {
  return {
    'data-ampless-tweet': '',
    'data-tweet-id': String(attrs.tweetId ?? ''),
    class: 'ampless-tweet-placeholder',
  }
}

/** HTML-escape a single attribute value (prevents attribute injection). */
function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Serialise a flat attribute dict to an HTML attribute string. */
function attrsToHtmlString(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([k, v]) => (v === '' ? k : `${k}="${escapeAttr(v)}"`))
    .join(' ')
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
        // Defensive fallback for genuinely top-level bare-URL `<a>` tags
        // (no parent block, or directly under `<body>` — = HTML fragments
        // without a paragraph wrapper at all). The primary case is the
        // markdown bare URL line `<p><a href=URL>URL</a></p>`, which is
        // already handled by the `tag: 'p'` rule above (priority 100,
        // `getBareUrlLinkHref`). This rule covers the rare standalone-link
        // shape that bypasses that rule entirely.
        //
        // Scope is deliberately narrow:
        //   1. Link text equals href — `<a href="URL">caption</a>` stays
        //      a captioned Link, not silently swallowed into an embed.
        //   2. Parent is null or `<body>` only. Inside any content block
        //      (`<p>`, `<li>`, `<blockquote>`, `<div>`, …) the autolink
        //      stays an inline Link mark to preserve the surrounding
        //      structure. Promoting it would split `<li>` into an empty
        //      paragraph item plus a list-external embed, break
        //      blockquotes, etc.
        tag: 'a[href]',
        priority: 100,
        getAttrs: (el) => {
          const link = el as HTMLElement
          const parent = link.parentElement
          if (parent && parent.tagName.toLowerCase() !== 'body') return false
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
      mergeAttributes(HTMLAttributes, placeholderAttrs({
        tweetId: HTMLAttributes['data-tweet-id'],
      })),
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

import type { TiptapNodeHtmlAdapters } from 'ampless'

/**
 * tiptap → html adapter map. Serialises `amplessTweet` nodes to the
 * canonical placeholder div `<div data-ampless-tweet data-tweet-id="..."
 * class="ampless-tweet-placeholder">…</div>` so the admin's
 * "format: tiptap → html" body switch is lossless. The div is what
 * `Node.parseHTML`'s `tag: 'div[data-ampless-tweet]'` rule restores
 * from. It is an admin format-switch interchange form; public rendering
 * expands tweet embeds from the `tiptap` / `markdown` walkers, while
 * `format: 'html'` preserves the div literally.
 *
 * `markdown → html` is a 2-hop via `generateJSON` (in admin format-switch);
 * this adapter is reused by that path — no duplicate logic needed.
 *
 * `update-ampless` reads this export (via namespace import `* as`) and
 * wires it into `installAdminTiptapNodeHtml`.
 */
export const tiptapNodeToHtml: TiptapNodeHtmlAdapters = {
  amplessTweet: (node) => {
    const tweetId = String(node.attrs?.tweetId ?? '').trim()
    if (!tweetId) return null
    const attrs = placeholderAttrs(node.attrs ?? {})
    // Inner content is a bare URL link, not the editor visual label
    // (`<span>Tweet: id</span>` that lives only in Node.renderHTML).
    // Reasons: (a) public render of `format: 'html'` posts shows this
    // body literally, so an editor-internal label would leak; (b) the
    // URL link gracefully degrades — viewers without iframe expansion
    // still get a clickable link to the source tweet; (c) it mirrors
    // the markdown canonical form (bare URL line), keeping the
    // canonical 3-format mapping symmetric. The parseHTML
    // `tag: 'div[data-ampless-tweet]'` rule reads `data-tweet-id`
    // via addAttributes.tweetId.parseHTML, so the inner content is
    // irrelevant for round-trip.
    const url = `https://x.com/i/status/${tweetId}`
    return `<div ${attrsToHtmlString(attrs)}><a href="${escapeAttr(url)}">${escapeAttr(url)}</a></div>`
  },
}
