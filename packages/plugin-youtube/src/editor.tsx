'use client'

// `@ampless/plugin-youtube/editor` — client-side tiptap Node extension
// for the admin editor. Templates wire this up in
// `_editor-bootstrap.tsx`:
//
//   'use client'
//   import { installAdminEditorExtensions } from '@ampless/admin/editor'
//   import { youtubeEditor } from '@ampless/plugin-youtube/editor'
//   export function EditorBootstrap({ children }) {
//     installAdminEditorExtensions([youtubeEditor.extension])
//     return <>{children}</>
//   }
//
// The Node is `atom: true` (not editable inline) — once inserted the
// user can drag/select/delete it as a block but not type inside it.
// Paste rules + slash command equivalent live here so authors can drop
// a YouTube URL into the editor and have it auto-replace into the
// embed node.

import { Node, mergeAttributes } from '@tiptap/core'
import { parseYoutubeUrl, YOUTUBE_URL } from './shared.js'

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
    amplessYoutube: {
      /** Insert a YouTube embed node with the given video id (+ optional start). */
      setYoutube: (opts: { videoId: string; start?: number }) => ReturnType
      /**
       * Insert a YouTube embed from a URL. Returns false (and does
       * nothing) if the URL doesn't match the canonical / short form.
       */
      insertYoutubeFromUrl: (url: string) => ReturnType
    }
  }
}

/**
 * Returns the canonical flat attribute dictionary for a YouTube embed
 * placeholder div. Used by both `Node.renderHTML` (consumed via
 * `mergeAttributes` → DOMOutputSpec array) and `tiptapNodeToHtml`
 * (HTML-encoded into a `<div ...>` string). Single source of truth for
 * the attribute set the parseHTML `tag: 'div[data-ampless-youtube]'`
 * rule restores from.
 */
function placeholderAttrs(attrs: { videoId?: unknown; start?: unknown }): Record<string, string> {
  const out: Record<string, string> = {
    'data-ampless-youtube': '',
    'data-video-id': String(attrs.videoId ?? ''),
    class: 'ampless-youtube-placeholder',
  }
  if (attrs.start != null && Number.isFinite(Number(attrs.start))) {
    out['data-start'] = String(attrs.start)
  }
  return out
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

export const AmplessYoutubeNode = Node.create({
  name: 'amplessYoutube',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      videoId: {
        default: '',
        parseHTML: (el: HTMLElement) => {
          const dataVideoId = el.getAttribute('data-video-id')
          if (dataVideoId != null) return dataVideoId

          // Defensive fallback for the `tag: 'div[data-ampless-youtube]'`
          // self-render rule. That rule has no `getAttrs`, so tiptap consults
          // this addAttributes.parseHTML — and the higher-priority `tag: 'p'`
          // / `tag: 'a[href]'` rules already have their own getAttrs so they
          // don't reach here. If the malformed `<div data-ampless-youtube>`
          // somehow lost its `data-video-id` (e.g. a downstream HTML sanitiser
          // stripped data-* attrs but left the tag) we try to recover the id
          // from a bare URL link inside it. Normal happy-path HTML never hits
          // this branch.
          const href = getBareUrlLinkHref(el)
          return href ? (parseYoutubeUrl(href) ?? '') : ''
        },
        renderHTML: (attrs: Record<string, unknown>) => ({
          'data-video-id': String(attrs.videoId ?? ''),
        }),
      },
      start: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('data-start')
          if (v === null) return null
          const n = Number(v)
          return Number.isFinite(n) ? n : null
        },
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.start != null ? { 'data-start': String(attrs.start) } : {},
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-ampless-youtube]',
      },
      {
        tag: 'p',
        priority: 100,
        getAttrs: (el) => {
          const href = getBareUrlLinkHref(el as HTMLElement) ?? ''
          const videoId = parseYoutubeUrl(href)
          if (!videoId) return false
          return { videoId, start: null }
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
          const videoId = parseYoutubeUrl(href)
          if (!videoId) return false
          return { videoId, start: null }
        },
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, placeholderAttrs({
        videoId: HTMLAttributes['data-video-id'],
        start: HTMLAttributes['data-start'],
      })),
      ['span', {}, `YouTube: ${HTMLAttributes['data-video-id'] ?? ''}`],
    ]
  },
  addCommands() {
    return {
      setYoutube:
        (opts) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { videoId: opts.videoId, start: opts.start ?? null },
          }),
      insertYoutubeFromUrl:
        (url) =>
        ({ commands }) => {
          const videoId = parseYoutubeUrl(url)
          if (!videoId) return false
          return commands.insertContent({
            type: this.name,
            attrs: { videoId, start: null },
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
        find: new RegExp(YOUTUBE_URL.source, 'g'),
        handler: ({ range, match, commands }: any) => {
          const videoId = match[1] ?? match[2]
          if (!videoId) return
          commands.deleteRange(range)
          commands.insertContent({
            type: this.name,
            attrs: { videoId, start: null },
          })
        },
      }) as never,
    ]
  },
})

/**
 * Named export consumed by templates' `_editor-bootstrap.tsx`. The
 * `.extension` field is the tiptap Node — the wrapper object exists so
 * future per-instance configuration can be added without breaking the
 * call site.
 */
export const youtubeEditor = {
  extension: AmplessYoutubeNode,
}

/**
 * Canonical named export consumed by the codegen'd
 * `_editor-bootstrap.tsx`. Plugins MUST export this symbol from
 * their `./editor` module (= the subpath declared in
 * `package.json#amplessPlugin.editorExports`) for the
 * auto-wiring to find them.
 */
export const editorExtension = AmplessYoutubeNode

import type { TiptapNodeMarkdownAdapters } from 'ampless'

/**
 * tiptap → markdown adapter map. Serialises `amplessYoutube` nodes back
 * to a bare `https://youtu.be/<videoId>` URL line so the admin's
 * "format: tiptap → markdown" body switch is lossless. The reverse
 * direction (URL → embed node on paste) is handled by the existing paste
 * rule + `extractSingleUrl` path in the runtime.
 *
 * `update-ampless` reads this export (via namespace import `* as`) and
 * wires it into `installAdminTiptapNodeMarkdown`.
 */
export const tiptapNodeToMarkdown: TiptapNodeMarkdownAdapters = {
  amplessYoutube: (node) => {
    const videoId = String(node.attrs?.videoId ?? '').trim()
    if (!videoId) return null
    return `https://youtu.be/${videoId}`
  },
}

import type { TiptapNodeHtmlAdapters } from 'ampless'

/**
 * tiptap → html adapter map. Serialises `amplessYoutube` nodes to the
 * canonical placeholder div `<div data-ampless-youtube data-video-id="..."
 * class="ampless-youtube-placeholder">…</div>` so the admin's
 * "format: tiptap → html" body switch is lossless. The div is what
 * `Node.parseHTML`'s `tag: 'div[data-ampless-youtube]'` rule restores
 * from, and what `publicHtmlForPost` expands to the real iframe at
 * public render time (concept separation preserved).
 *
 * `markdown → html` is a 2-hop via `generateJSON` (in admin format-switch);
 * this adapter is reused by that path — no duplicate logic needed.
 *
 * `update-ampless` reads this export (via namespace import `* as`) and
 * wires it into `installAdminTiptapNodeHtml`.
 */
export const tiptapNodeToHtml: TiptapNodeHtmlAdapters = {
  amplessYoutube: (node) => {
    const videoId = String(node.attrs?.videoId ?? '').trim()
    if (!videoId) return null
    const attrs = placeholderAttrs(node.attrs ?? {})
    return `<div ${attrsToHtmlString(attrs)}><span>YouTube: ${escapeAttr(videoId)}</span></div>`
  },
}
