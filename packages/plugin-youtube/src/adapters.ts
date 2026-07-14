// Server-safe adapters for the `amplessYoutube` tiptap node. No
// `'use client'` and no `@tiptap/*` import — this module is imported by both
// `./editor.tsx` (admin, client-side) and `./index.tsx` (server) so the
// manifest's `tiptapNodeToMarkdown` field can reach it without pulling
// tiptap into the public runtime bundle.

/**
 * Returns the canonical flat attribute dictionary for a YouTube embed
 * placeholder div. Used by both `Node.renderHTML` (consumed via
 * `mergeAttributes` → DOMOutputSpec array) and `tiptapNodeToHtml`
 * (HTML-encoded into a `<div ...>` string). Single source of truth for
 * the attribute set the parseHTML `tag: 'div[data-ampless-youtube]'`
 * rule restores from.
 */
export function placeholderAttrs(attrs: { videoId?: unknown; start?: unknown }): Record<string, string> {
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
export function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Serialise a flat attribute dict to an HTML attribute string. */
export function attrsToHtmlString(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([k, v]) => (v === '' ? k : `${k}="${escapeAttr(v)}"`))
    .join(' ')
}

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
 * from. It is an admin format-switch interchange form; public rendering
 * expands YouTube embeds from the `tiptap` / `markdown` walkers, while
 * `format: 'html'` preserves the div literally.
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
    // Inner content is a bare URL link, not the editor visual label
    // (`<span>YouTube: id</span>` that lives only in Node.renderHTML).
    // Reasons: (a) public render of `format: 'html'` posts shows this
    // body literally, so an editor-internal label would leak; (b) the
    // URL link gracefully degrades — viewers without iframe expansion
    // still get a clickable link to the source video; (c) it mirrors
    // the markdown canonical form (bare URL line), keeping the
    // canonical 3-format mapping symmetric. The parseHTML
    // `tag: 'div[data-ampless-youtube]'` rule reads `data-video-id`
    // via addAttributes.videoId.parseHTML, so the inner content is
    // irrelevant for round-trip.
    const url = `https://youtu.be/${videoId}`
    return `<div ${attrsToHtmlString(attrs)}><a href="${escapeAttr(url)}">${escapeAttr(url)}</a></div>`
  },
}
