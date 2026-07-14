import {
  Fragment,
  createElement,
  type ReactNode,
} from 'react'
import { marked, type Tokens } from 'marked'
// Server-side HTML parser used by the public html walker (`renderHtmlNode`)
// to expand registered embed placeholder divs in `format: 'html'` bodies.
// htmlparser2 is a direct dependency (also present transitively via
// sanitize-html, but pnpm forbids importing transitive packages, so the
// runtime declares it explicitly). `ElementType` provides the `isTag`
// type guard / element-type enum without pulling domhandler in directly.
import { parseDocument, ElementType } from 'htmlparser2'
import type {
  AmplessPlugin,
  ContentFieldRenderer,
  MarkdownEmbedMatch,
  PluginPublicRenderContext,
  Post,
  TiptapNodeToMarkdown,
  TiptapNodeMarkdownAdapters,
  TiptapNodeHtmlAdapters,
  TiptapRenderNode,
} from 'ampless'

// NOTE: editor は信頼された主体として扱う設計のため、本ファイルでは
// 投稿本文に含まれる HTML / JavaScript を**意図的にサニタイズしない**。
// editor が `attrs.alt` 等の属性経由で `"` をブレイクアウトして任意の
// JS を仕込めること、`format: 'html'` で `<script>` を保存できること
// は仕様。詳細は docs/architecture/04-access-layer-mcp.md の
// 「editor の信頼モデル（仕様）」を参照。
//
// このコメントを読んでサニタイズを追加したくなった場合、まずその設計
// 判断を読んでから、必要なら opt-in プラグインとして実装すること。

// タグ構造を壊さないための最低限のエスケープ（XSS 対策ではない）。
function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface TiptapNode {
  type: string
  content?: TiptapNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  attrs?: Record<string, unknown>
}

// textAlign の正当値だけ通すホワイトリスト。任意の attr 値を style に
// そのまま流すと壊れた CSS が混入しうるため。
function textAlignStyle(attrs: Record<string, unknown> | undefined): string {
  const v = attrs?.textAlign
  if (v === 'left' || v === 'center' || v === 'right' || v === 'justify') {
    return ` style="text-align: ${v}"`
  }
  return ''
}

// ---- HTML-string tiptap renderer (used by legacy sync path + format converters) ----

function renderTiptapString(
  node: TiptapNode,
  opts?: { nodeAdapters?: TiptapNodeHtmlAdapters },
): string {
  // **Adapter first**: if a plugin registered a tiptap→html adapter for this
  // nodeType, prefer its output. Atom nodes (e.g. amplessYoutube) would
  // otherwise fall through the default switch with empty children, silently
  // dropping the embed when the operator switches format tiptap → html in the
  // admin.
  const adapter = opts?.nodeAdapters?.[node.type]
  if (adapter) {
    const out = adapter(node as TiptapRenderNode)
    if (typeof out === 'string') return out
    // out === null means the adapter explicitly defers to the default
    // switch below (= plugin says "use the built-in handling").
  }

  if (node.type === 'text') {
    let html = escape(node.text ?? '')
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') html = `<strong>${html}</strong>`
      else if (mark.type === 'italic') html = `<em>${html}</em>`
      else if (mark.type === 'code') html = `<code>${html}</code>`
      else if (mark.type === 'strike') html = `<s>${html}</s>`
      else if (mark.type === 'underline') html = `<u>${html}</u>`
      else if (mark.type === 'highlight') html = `<mark>${html}</mark>`
      else if (mark.type === 'link') {
        const href = escape(String(mark.attrs?.href ?? '#'))
        html = `<a href="${href}" target="_blank" rel="noopener">${html}</a>`
      }
    }
    return html
  }

  const children = (node.content ?? []).map((c) => renderTiptapString(c, opts)).join('')

  switch (node.type) {
    case 'doc':
      return children
    case 'paragraph':
      return `<p${textAlignStyle(node.attrs)}>${children}</p>`
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      return `<h${level}${textAlignStyle(node.attrs)}>${children}</h${level}>`
    }
    case 'bulletList':
      return `<ul>${children}</ul>`
    case 'orderedList':
      return `<ol>${children}</ol>`
    case 'listItem':
      return `<li>${children}</li>`
    case 'codeBlock': {
      const lang = node.attrs?.language ? ` class="language-${escape(String(node.attrs.language))}"` : ''
      return `<pre><code${lang}>${children}</code></pre>`
    }
    case 'blockquote':
      return `<blockquote>${children}</blockquote>`
    case 'hardBreak':
      return '<br />'
    case 'horizontalRule':
      return '<hr />'
    case 'image': {
      const src = escape(String(node.attrs?.src ?? ''))
      const alt = escape(String(node.attrs?.alt ?? ''))
      const title = node.attrs?.title ? ` title="${escape(String(node.attrs.title))}"` : ''
      const display = node.attrs?.display
        ? ` data-display="${escape(String(node.attrs.display))}"`
        : ''
      return `<img src="${src}" alt="${alt}"${title}${display} loading="lazy" />`
    }
    case 'table':
      return `<table class="tiptap-table"><tbody>${children}</tbody></table>`
    case 'tableRow':
      return `<tr>${children}</tr>`
    case 'tableHeader':
      return `<th${tableCellAttrs(node.attrs)}>${children}</th>`
    case 'tableCell':
      return `<td${tableCellAttrs(node.attrs)}>${children}</td>`
    case 'taskList':
      return `<ul data-type="taskList">${children}</ul>`
    case 'taskItem': {
      const checked = node.attrs?.checked === true ? 'true' : 'false'
      return `<li data-type="taskItem" data-checked="${checked}">${children}</li>`
    }
    default:
      return children
  }
}

function tableCellAttrs(attrs: Record<string, unknown> | undefined): string {
  let out = ''
  const colspan = Number(attrs?.colspan ?? 1)
  if (colspan > 1) out += ` colspan="${colspan}"`
  const rowspan = Number(attrs?.rowspan ?? 1)
  if (rowspan > 1) out += ` rowspan="${rowspan}"`
  const colwidth = attrs?.colwidth
  if (Array.isArray(colwidth) && colwidth.length > 0) {
    const w = Number(colwidth[0])
    if (Number.isFinite(w) && w > 0) out += ` style="width: ${w}px"`
  }
  return out
}

function renderMarkdownString(md: string): string {
  // marked: parse は async: false で同期実行できるが、型は
  // `string | Promise<string>` を返すため as string でキャストする。
  // sanitize オプションは marked から廃止済み。出力は信頼境界として扱う既存方針を維持。
  return marked.parse(md, { gfm: true, breaks: false, async: false }) as string
}

// ---- Phase 7: contentFields registry ----

/**
 * Registry of `contentFields` renderers, plus a per-plugin context
 * resolver. Built once per request from `cms.config.plugins` by
 * `createPluginHead.contentFieldsRegistry` and threaded through every
 * `renderBody(post, { contentFields, ctxForPlugin })` call.
 *
 * The map values capture the original plugin so the runtime can rebind
 * `this` and resolve the right `PluginPublicRenderContext` for each
 * renderer at call time.
 */
export interface ContentFieldRegistry {
  tiptap: ReadonlyMap<string, { plugin: AmplessPlugin; renderer: Extract<ContentFieldRenderer, { kind: 'tiptap' }> }>
  markdownUrl: ReadonlyArray<{
    plugin: AmplessPlugin
    renderer: Extract<ContentFieldRenderer, { kind: 'markdown-url' }>
  }>
  /**
   * Plugins that declared `htmlPlaceholder` on their `kind: 'tiptap'`
   * entry, keyed by the **lowercased** `flagAttr` (htmlparser2 lowercases
   * HTML attribute names while parsing, so the public html walker looks
   * up `attribs[flagAttr.toLowerCase()]` and compares against these keys
   * case-insensitively). Used by `renderHtmlNode` to expand canonical
   * placeholder divs in `format: 'html'` bodies into the plugin's
   * existing tiptap renderer output.
   */
  htmlPlaceholder: ReadonlyMap<
    string,
    {
      plugin: AmplessPlugin
      renderer: Extract<ContentFieldRenderer, { kind: 'tiptap' }>
    }
  >
}

/**
 * Build a `ContentFieldRegistry` from a list of plugins. Eagerly errors
 * on duplicate `nodeType` / `pattern.source` registration across
 * plugins so the misuse surfaces at config time, not at the first
 * render that happens to walk the conflicting node.
 */
export function buildContentFieldRegistry(
  plugins: readonly AmplessPlugin[],
): ContentFieldRegistry {
  const tiptap = new Map<
    string,
    { plugin: AmplessPlugin; renderer: Extract<ContentFieldRenderer, { kind: 'tiptap' }> }
  >()
  const htmlPlaceholder = new Map<
    string,
    { plugin: AmplessPlugin; renderer: Extract<ContentFieldRenderer, { kind: 'tiptap' }> }
  >()
  const seenMarkdownPatterns = new Set<string>()
  const markdownUrl: Array<{
    plugin: AmplessPlugin
    renderer: Extract<ContentFieldRenderer, { kind: 'markdown-url' }>
  }> = []
  for (const plugin of plugins) {
    const fields = plugin.contentFields
    if (!fields) continue
    for (const field of fields) {
      if (field.kind === 'tiptap') {
        if (tiptap.has(field.nodeType)) {
          throw new Error(
            `[ampless contentFields] duplicate tiptap nodeType "${field.nodeType}" — already registered by another plugin. Each nodeType may be claimed by at most one plugin.`,
          )
        }
        tiptap.set(field.nodeType, { plugin, renderer: field })
        if (field.htmlPlaceholder) {
          // Normalize to lowercase: htmlparser2 lowercases attribute
          // names in HTML mode, so the walker's attribs lookup + fast-path
          // substring scan must use the normalized value. Duplicate
          // detection is on the normalized key too (`data-X` and `data-x`
          // collide).
          const flagAttr = field.htmlPlaceholder.flagAttr.toLowerCase()
          if (htmlPlaceholder.has(flagAttr)) {
            throw new Error(
              `[ampless contentFields] duplicate htmlPlaceholder flagAttr "${flagAttr}" — already registered by another plugin. Each flagAttr may be claimed by at most one plugin.`,
            )
          }
          htmlPlaceholder.set(flagAttr, { plugin, renderer: field })
        }
      } else if (field.kind === 'markdown-url') {
        const key = field.pattern.source
        if (seenMarkdownPatterns.has(key)) {
          throw new Error(
            `[ampless contentFields] duplicate markdown-url pattern "${key}" — already registered by another plugin. Each pattern may be claimed by at most one plugin.`,
          )
        }
        seenMarkdownPatterns.add(key)
        markdownUrl.push({ plugin, renderer: field })
      }
    }
  }
  return { tiptap, markdownUrl, htmlPlaceholder }
}

/**
 * Merge every plugin's server-safe `tiptapNodeToMarkdown` map into a
 * single `TiptapNodeMarkdownAdapters` registry. Eagerly errors on
 * duplicate `nodeType` registration across plugins (two different
 * functions) so the misuse surfaces at config time, not at the first
 * markdown conversion that happens to walk the conflicting node. The
 * exact same function registered twice (e.g. one shared adapter map
 * reused by two plugin instances) is tolerated.
 *
 * Non-function entries are skipped with a warning rather than thrown:
 * `definePlugin` already warns about them at definition time, and one
 * broken plugin shouldn't take the whole site's markdown output down
 * (a nodeType conflict, by contrast, is a config error — that throws).
 */
export function buildMarkdownAdapterRegistry(
  plugins: readonly AmplessPlugin[],
): TiptapNodeMarkdownAdapters {
  const merged: Record<string, TiptapNodeToMarkdown> = {}
  for (const plugin of plugins) {
    const adapters = plugin.tiptapNodeToMarkdown
    if (!adapters) continue
    for (const [nodeType, adapter] of Object.entries(adapters)) {
      if (typeof adapter !== 'function') {
        // eslint-disable-next-line no-console
        console.warn(
          `[ampless markdownAdapters] plugin "${plugin.instanceId ?? plugin.name}" declares a non-function tiptapNodeToMarkdown entry for nodeType "${nodeType}". Skipping the entry.`,
        )
        continue
      }
      const existing = merged[nodeType]
      if (existing && existing !== adapter) {
        throw new Error(
          `[ampless markdownAdapters] duplicate tiptap nodeType "${nodeType}" — already registered by another plugin. Each nodeType may be claimed by at most one plugin.`,
        )
      }
      merged[nodeType] = adapter
    }
  }
  return merged
}

export interface RenderBodyOptions {
  contentFields?: ContentFieldRegistry
  /**
   * Resolver invoked with the matched plugin to obtain the
   * `PluginPublicRenderContext` for the renderer call. Wired by
   * `createAmpless` so plugin renderers see the same `setting()`-bound
   * ctx as `publicHead` / `publicBodyEnd`.
   */
  ctxForPlugin?: (plugin: AmplessPlugin) => PluginPublicRenderContext
}

// ---- Phase 7: ReactNode tiptap walker (delegates to renderer registry) ----

function htmlPassthrough(html: string): ReactNode {
  return createElement('span', { dangerouslySetInnerHTML: { __html: html } })
}

// Block-safe wrapper for markdown walker non-embed batches, format='html',
// and tiptap string-body fallback. Using <div> instead of <span> avoids
// invalid block-inside-inline markup (e.g. <span><h1>...</h1></span>).
//
// `suppressHydrationWarning`: the post body is server-authoritative HTML
// that client-side plugins legitimately rewrite after load — e.g.
// @ampless/plugin-mermaid replaces `<pre>` blocks with rendered SVG and
// @ampless/plugin-highlight injects spans into `<code>`. Those run before
// React finishes hydrating, so without this React would warn that the
// hydrated DOM no longer matches the SSR HTML. There is no React-managed
// state inside this `dangerouslySetInnerHTML` subtree, so suppressing the
// mismatch here is correct (and keeps React from discarding the enhanced
// DOM). React strips this prop from the rendered output.
function htmlPassthroughBlock(html: string, key?: string): ReactNode {
  const props: Record<string, unknown> = {
    dangerouslySetInnerHTML: { __html: html },
    suppressHydrationWarning: true,
  }
  if (key !== undefined) props.key = key
  return createElement('div', props)
}

function renderTiptapNode(
  node: TiptapNode,
  opts: RenderBodyOptions,
  key: string,
): ReactNode {
  // Hook into the registry first — a registered nodeType replaces the
  // default switch entirely (no children walked by the runtime; the
  // plugin renderer owns the subtree).
  const reg = opts.contentFields?.tiptap.get(node.type)
  if (reg) {
    const ctx = opts.ctxForPlugin?.(reg.plugin)
    if (!ctx) {
      // Defensive: registry says renderer is here but ctx resolver
      // missing — drop the embed silently rather than throwing.
      return null
    }
    try {
      const out = reg.renderer.render(node as TiptapRenderNode, ctx)
      return createElement(Fragment, { key }, out)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ampless renderBody] plugin "${reg.plugin.instanceId ?? reg.plugin.name}" threw inside contentFields tiptap renderer for nodeType "${node.type}": ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  // Text nodes — delegate to the string path then wrap in a
  // dangerouslySetInnerHTML span so the existing mark output (with
  // escaping) is preserved verbatim.
  if (node.type === 'text') {
    return htmlPassthrough(renderTiptapString(node))
  }

  // Code blocks render as an opaque dangerouslySetInnerHTML island (like
  // text/markdown/html) so client plugins can mutate them without React
  // hydration regenerating the subtree: mermaid replaces the <pre>,
  // highlight injects spans into <code>. suppressHydrationWarning only
  // covers same-element attr/text diffs — not element replacement / deep
  // child injection — so an island React never traverses is the real fix.
  // Early-return before child recursion; the <pre><code> string already
  // carries the escaped content.
  if (node.type === 'codeBlock') {
    return htmlPassthroughBlock(renderTiptapString(node), key)
  }

  // Recurse into children producing ReactNode list, threading keys.
  const childNodes = node.content ?? []
  const children: ReactNode[] = childNodes.map((c, i) =>
    renderTiptapNode(c, opts, `${key}.${i}`),
  )

  switch (node.type) {
    case 'doc':
      return createElement(Fragment, { key }, ...children)
    case 'paragraph': {
      const align = textAlignStyleProp(node.attrs)
      return createElement('p', { key, ...align }, ...children)
    }
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      const tag = `h${level}` as 'h1'
      const align = textAlignStyleProp(node.attrs)
      return createElement(tag, { key, ...align }, ...children)
    }
    case 'bulletList':
      return createElement('ul', { key }, ...children)
    case 'orderedList':
      return createElement('ol', { key }, ...children)
    case 'listItem':
      return createElement('li', { key }, ...children)
    case 'blockquote':
      return createElement('blockquote', { key }, ...children)
    case 'hardBreak':
      return createElement('br', { key })
    case 'horizontalRule':
      return createElement('hr', { key })
    case 'image': {
      const src = String(node.attrs?.src ?? '')
      const alt = String(node.attrs?.alt ?? '')
      const title = node.attrs?.title ? String(node.attrs.title) : undefined
      const display = node.attrs?.display ? String(node.attrs.display) : undefined
      const props: Record<string, unknown> = {
        key,
        src,
        alt,
        loading: 'lazy',
      }
      if (title) props.title = title
      if (display) props['data-display'] = display
      return createElement('img', props)
    }
    case 'table':
      return createElement(
        'table',
        { key, className: 'tiptap-table' },
        createElement('tbody', null, ...children),
      )
    case 'tableRow':
      return createElement('tr', { key }, ...children)
    case 'tableHeader':
      return createElement('th', { key, ...tableCellProps(node.attrs) }, ...children)
    case 'tableCell':
      return createElement('td', { key, ...tableCellProps(node.attrs) }, ...children)
    case 'taskList':
      return createElement('ul', { key, 'data-type': 'taskList' }, ...children)
    case 'taskItem': {
      const checked = node.attrs?.checked === true ? 'true' : 'false'
      return createElement(
        'li',
        { key, 'data-type': 'taskItem', 'data-checked': checked },
        ...children,
      )
    }
    default:
      return createElement(Fragment, { key }, ...children)
  }
}

function textAlignStyleProp(
  attrs: Record<string, unknown> | undefined,
): { style?: { textAlign: string } } {
  const v = attrs?.textAlign
  if (v === 'left' || v === 'center' || v === 'right' || v === 'justify') {
    return { style: { textAlign: v } }
  }
  return {}
}

function tableCellProps(
  attrs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const colspan = Number(attrs?.colspan ?? 1)
  if (colspan > 1) out.colSpan = colspan
  const rowspan = Number(attrs?.rowspan ?? 1)
  if (rowspan > 1) out.rowSpan = rowspan
  const colwidth = attrs?.colwidth
  if (Array.isArray(colwidth) && colwidth.length > 0) {
    const w = Number(colwidth[0])
    if (Number.isFinite(w) && w > 0) out.style = { width: `${w}px` }
  }
  return out
}

// ---- Phase 7: markdown walker (marked.lexer-based) ----

/**
 * Walk markdown via `marked.lexer` so the runtime can intercept
 * `paragraph` tokens whose entire content is a single URL matching one
 * of the registered `markdown-url` patterns. Everything else falls
 * through to `marked.parser` and is emitted via a block-safe
 * `dangerouslySetInnerHTML` div (preserving raw HTML token passthrough
 * exactly like the legacy sync path). Consecutive non-embed tokens are
 * batched into a single `marked.parser` call and wrapped in one `<div>`
 * to avoid per-token wrapper proliferation.
 */
function renderMarkdownNode(md: string, opts: RenderBodyOptions): ReactNode {
  const tokens = marked.lexer(md, { gfm: true, breaks: false })
  const children: ReactNode[] = []
  let pending: Tokens.Generic[] = []
  let chunk = 0

  const flush = () => {
    if (pending.length === 0) return
    const html = marked.parser(pending, { gfm: true, breaks: false })
    children.push(htmlPassthroughBlock(html, `md-html-${chunk++}`))
    pending = []
  }

  tokens.forEach((token, i) => {
    const match = matchMarkdownUrlEmbed(token, opts)
    if (match) {
      flush()
      children.push(createElement(Fragment, { key: `md-embed-${i}` }, match))
    } else {
      pending.push(token)
    }
  })
  flush()

  return createElement(Fragment, null, ...children)
}

/**
 * Test whether a marked paragraph token is a single-line URL match for
 * one of the registered embed patterns. Accepts two shapes:
 *   1. `paragraph` whose entire content is one `text` token (bare URL —
 *      defensive fallback for marked configs that emit plain-text URLs)
 *   2. `paragraph` whose entire content is one `link` token where
 *      `raw === href` (= GFM bare URL paragraph, e.g. `https://youtu.be/…`
 *      on its own line that marked@18 emits as a `link` token)
 *
 * Rejects `<https://…>` autolinks (`raw` includes `<>`) and
 * `[caption](url)` links (`raw` includes `[]()`), keeping body rendering
 * consistent with `hasTweetUrlInMarkdown` which keys on bare URL lines.
 */
function matchMarkdownUrlEmbed(
  token: Tokens.Generic | Tokens.Paragraph,
  opts: RenderBodyOptions,
): ReactNode | null {
  if (!opts.contentFields || opts.contentFields.markdownUrl.length === 0) {
    return null
  }
  if (token.type !== 'paragraph') return null
  const para = token as Tokens.Paragraph
  // Extract a single URL candidate from the paragraph if it has one,
  // bail otherwise.
  const url = extractSingleUrl(para)
  if (!url) return null
  for (const entry of opts.contentFields.markdownUrl) {
    const m = url.match(entry.renderer.pattern)
    if (!m) continue
    const ctx = opts.ctxForPlugin?.(entry.plugin)
    if (!ctx) return null
    try {
      return entry.renderer.render({ match: m, raw: url }, ctx)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ampless renderBody] plugin "${entry.plugin.instanceId ?? entry.plugin.name}" threw inside contentFields markdown-url renderer for pattern "${entry.renderer.pattern.source}": ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }
  return null
}

function extractSingleUrl(para: Tokens.Paragraph): string | null {
  const tokens = (para.tokens ?? []) as Array<Tokens.Generic>
  if (tokens.length === 0) return null

  // Allow leading/trailing whitespace text tokens.
  const trimmed = tokens.filter((t) => {
    if (t.type === 'text') return (t.raw ?? '').trim().length > 0
    return true
  })
  if (trimmed.length !== 1) return null
  const t = trimmed[0]!
  if (t.type === 'link') {
    // marked@18 emits bare URL paragraphs as `link` tokens (GFM
    // autolink). Accept ONLY when the raw source equals the href
    // — that is the "bare URL on its own line" case. Reject
    // `<https://...>` (raw has `<>`) and `[caption](url)` (raw has
    // `[]()`) so the body intercept stays consistent with
    // `hasTweetUrlInMarkdown`, which keys on `TWEET_URL.test(line.trim())`
    // = bare URL line only.
    const link = t as Tokens.Link
    const href = (link.href ?? '').trim()
    const raw = (link.raw ?? '').trim()
    if (!href || raw !== href) return null
    return href
  }
  if (t.type === 'text') {
    // Defensive fallback: some marked configurations / older versions
    // emit bare URLs as `text` tokens. Keep this branch so a tooling
    // bump doesn't silently break embeds.
    const text = ((t as Tokens.Text).text ?? '').trim()
    return text || null
  }
  return null
}

// ---- Phase 7 add-on: public html walker (htmlparser2 index slicing) ----

/**
 * Minimal structural shape of a parsed element node the walker reads.
 * htmlparser2 doesn't re-export domhandler's `Element` type / `isTag`
 * type guard (and pnpm forbids importing the transitive `domhandler`
 * directly), so we narrow `ChildNode` via `ElementType.isTag` + this
 * local interface rather than coupling to domhandler's class.
 */
interface ParsedElement {
  attribs: Record<string, string>
  startIndex: number | null
  endIndex: number | null
}

/**
 * Type guard narrowing a parsed child node to an element with `attribs`
 * + index range. `ElementType.isTag` returns a plain boolean (Tag /
 * Script / Style), so we pair it with a structural cast.
 */
function isParsedElement<T extends { type: ElementType.ElementType }>(
  node: T,
): node is T & ParsedElement {
  return ElementType.isTag(node)
}


/**
 * Render a `format: 'html'` post body, expanding registered embed
 * placeholder divs into the plugin's existing `kind: 'tiptap'` renderer
 * output while passing everything else through as **byte-for-byte
 * original-string slices** (never DOM re-serialisation).
 *
 * A placeholder is a **top-level** (depth-0) element carrying a
 * registered `flagAttr` (e.g. `<div data-ampless-youtube …>`). The admin's
 * `tiptap → html` format switch emits these canonical divs; this walker
 * is what makes the `html` format reach the same React renderer as the
 * `tiptap` / `markdown` formats. Nested placeholders (inside
 * `<blockquote>` / `<li>` / etc.) stay literal — consistent with the
 * editor's body-level-only `parseHTML` fallback.
 *
 * Fast path (zero regression for posts without placeholders): if the
 * registry has no `htmlPlaceholder` entries, or none of the registered
 * flagAttrs appear as a substring of the (lowercased) body, return a
 * single `htmlPassthroughBlock(html)` — markup-identical to the previous
 * raw-passthrough behaviour.
 *
 * Error policy (graceful degradation — the body is engineer-authored, so
 * preserve content rather than drop it):
 *   - `attrsFromElement` or `render` throwing → `console.warn` + raw
 *     slice fallback (the placeholder div, including its clickable link,
 *     stays visible).
 *   - ctx resolver returning nothing → raw slice fallback.
 *   - htmlparser2 throwing (effectively never) → whole-body
 *     `htmlPassthroughBlock(html)` fallback.
 *
 * Note on DOM structure: a body with placeholders changes from a single
 * wrapper div (raw passthrough) to multiple wrapper divs interleaved with
 * the React embed siblings. The bytes inside each raw chunk are preserved
 * exactly, but the wrapper boundaries shift — direct-child / adjacent-
 * sibling CSS selectors that assumed one wrapper won't match the same way.
 * Placeholder-free posts keep the single wrapper via the fast path.
 */
function renderHtmlNode(html: string, opts: RenderBodyOptions): ReactNode {
  const registry = opts.contentFields?.htmlPlaceholder
  // Fast path (a): no plugin opted in.
  if (!registry || registry.size === 0) {
    return htmlPassthroughBlock(html)
  }
  // Fast path (b): none of the registered flagAttrs appear in the body.
  // Case-insensitive: registry keys are already lowercase; lowercase the
  // body once. NOT a fixed `'data-ampless'` prefix check — flagAttr is an
  // arbitrary attribute name (a site-local plugin can declare
  // `data-my-embed`), so a fixed prefix would never expand those.
  const lower = html.toLowerCase()
  let anyFlagPresent = false
  for (const flagAttr of registry.keys()) {
    if (lower.includes(flagAttr)) {
      anyFlagPresent = true
      break
    }
  }
  if (!anyFlagPresent) {
    return htmlPassthroughBlock(html)
  }

  let doc
  try {
    doc = parseDocument(html, {
      withStartIndices: true,
      withEndIndices: true,
    })
  } catch (err) {
    // htmlparser2 is famously tolerant and effectively never throws, but
    // if it does we fall back to whole-body raw passthrough rather than
    // dropping the engineer's content.
    // eslint-disable-next-line no-console
    console.warn(
      `[ampless renderBody] htmlparser2 failed to parse a format:'html' body; falling back to raw passthrough: ${err instanceof Error ? err.message : String(err)}`,
    )
    return htmlPassthroughBlock(html)
  }

  const children: ReactNode[] = []
  let chunk = 0
  // `cursor` tracks the next unconsumed byte in the original string. The
  // region between the previous placeholder's end and the next
  // placeholder's start (raw text, comments, whitespace, non-placeholder
  // elements) is emitted as one original-string slice — preserving bytes
  // exactly. Top-level children's inclusive slices reconstruct the source
  // verbatim, so slicing on indices is byte-faithful.
  let cursor = 0

  const flushRawUntil = (end: number) => {
    if (end <= cursor) return
    const slice = html.slice(cursor, end)
    children.push(htmlPassthroughBlock(slice, `html-raw-${chunk++}`))
    cursor = end
  }

  for (const node of doc.children) {
    // Only element nodes (Tag/Script/Style) can carry the flag attr; text,
    // comments, directives, etc. are part of the surrounding raw slices.
    if (!isParsedElement(node)) continue
    if (node.startIndex == null || node.endIndex == null) continue
    const reg = matchHtmlPlaceholder(node.attribs, registry)
    if (!reg) continue

    // domhandler endIndex is INCLUSIVE of the terminal `>` — slice with
    // `endIndex + 1` so the closing `>` isn't dropped.
    const start = node.startIndex
    const endExclusive = node.endIndex + 1

    // Emit the raw region preceding this placeholder.
    flushRawUntil(start)

    const placeholderSlice = html.slice(start, endExclusive)
    const ctx = opts.ctxForPlugin?.(reg.plugin)
    if (!ctx) {
      // Defensive: registry says renderer is here but ctx resolver
      // missing. Preserve the engineer-authored placeholder (its link
      // stays clickable) rather than dropping content.
      children.push(htmlPassthroughBlock(placeholderSlice, `html-raw-${chunk++}`))
      cursor = endExclusive
      continue
    }
    try {
      // `attrsFromElement` and `render` share ONE try/catch: HTML attribs
      // come from the post body, so even the attr→node-attrs conversion
      // can throw. Either throwing → warn + raw slice fallback.
      const renderNode: TiptapRenderNode = {
        type: reg.renderer.nodeType,
        attrs: reg.renderer.htmlPlaceholder!.attrsFromElement(node.attribs),
      }
      const out = reg.renderer.render(renderNode, ctx)
      children.push(createElement(Fragment, { key: `html-embed-${start}` }, out))
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ampless renderBody] plugin "${reg.plugin.instanceId ?? reg.plugin.name}" threw inside contentFields tiptap renderer for nodeType "${reg.renderer.nodeType}": ${err instanceof Error ? err.message : String(err)}`,
      )
      children.push(htmlPassthroughBlock(placeholderSlice, `html-raw-${chunk++}`))
    }
    cursor = endExclusive
  }

  // Trailing raw region after the last placeholder.
  flushRawUntil(html.length)

  return createElement(Fragment, null, ...children)
}

/**
 * Find the `htmlPlaceholder` registry entry whose (lowercased) flagAttr is
 * present on this element's attributes. htmlparser2 lowercases attribute
 * names in HTML mode, and registry keys are lowercased at registration, so
 * the lookup is a direct `attribs` key check. Returns the first match (a
 * single element carrying two registered flags is vanishingly unlikely;
 * first-match keeps the walk deterministic).
 */
function matchHtmlPlaceholder(
  attribs: Record<string, string>,
  registry: ReadonlyMap<
    string,
    { plugin: AmplessPlugin; renderer: Extract<ContentFieldRenderer, { kind: 'tiptap' }> }
  >,
): { plugin: AmplessPlugin; renderer: Extract<ContentFieldRenderer, { kind: 'tiptap' }> } | null {
  for (const flagAttr of registry.keys()) {
    if (Object.prototype.hasOwnProperty.call(attribs, flagAttr)) {
      return registry.get(flagAttr) ?? null
    }
  }
  return null
}

// ---- Public entry points ----

/**
 * Async + ReactNode-shaped post body renderer. The runtime threads its
 * `contentFields` registry + per-plugin ctx resolver in via `opts`; a
 * raw direct caller (tests etc.) can omit `opts` to fall back to the
 * default embed-free behaviour.
 *
 * Themes should call this through `ampless.renderBody(post)` (which
 * supplies both opts) rather than calling this low-level function
 * directly.
 */
export function renderBody(post: Post, opts: RenderBodyOptions = {}): ReactNode {
  // 仕様: editor は信頼された主体。`'html'` フォーマットは body をその
  // ままレンダリングする (任意 HTML / script 可)。ファイル冒頭のコメント
  // および 04-access-layer-mcp.md を参照。
  //
  // The public html walker (`renderHtmlNode`) expands registered embed
  // placeholder divs (e.g. `<div data-ampless-youtube …>`) into the same
  // React renderer the tiptap / markdown walkers use, while passing all
  // other markup through unchanged (byte-faithful original-string slices).
  // Posts without placeholders hit the fast path = identical single-wrapper
  // raw passthrough as before.
  if (post.format === 'html') {
    return renderHtmlNode(String(post.body), opts)
  }
  if (post.format === 'markdown') {
    return renderMarkdownNode(String(post.body), opts)
  }
  if (post.format === 'tiptap') {
    if (typeof post.body === 'string') {
      // Defensive: a tiptap-formatted post may have its body persisted
      // as a raw HTML string if the admin saved straight after a
      // format-switch sequence (markdown -> tiptap -> save without
      // editing). Treat string bodies as already-rendered HTML rather
      // than crashing into empty output.
      return htmlPassthroughBlock(post.body)
    }
    return renderTiptapNode(post.body as TiptapNode, opts, 'root')
  }
  return null
}

/**
 * Sync string-shaped renderer used by `routes/raw.ts` and by format
 * converters that need a `string` output. Skips the `contentFields`
 * registry entirely — the raw route serves `format: 'html'` posts
 * directly, and the format converters operate on tiptap / markdown
 * source that doesn't expand embed shortcuts.
 */
export function renderBodyHtmlString(post: Post): string {
  if (post.format === 'html') return String(post.body)
  if (post.format === 'markdown') return renderMarkdownString(String(post.body))
  if (post.format === 'tiptap') {
    if (typeof post.body === 'string') return post.body
    return renderTiptapString(post.body as TiptapNode)
  }
  return ''
}

// --- Format converters ---
//
// Used by the admin post form to preserve the user's work when they
// switch format mid-edit. Round-trips are best-effort: tiptap -> html
// is exact, the others approximate. Tables, complex inline marks,
// and tiptap-specific attributes (image display modes etc.) may not
// survive a markdown trip.

/**
 * Convert a tiptap doc to its HTML form. Same renderer the public
 * site uses. Defensive: tiptap accepts an HTML string as initial
 * content and parses it on mount, but won't fire onUpdate until the
 * user edits, so a format-switch chain (e.g. markdown -> tiptap ->
 * markdown without editing) can still hand us a raw HTML string
 * here. In that case, return it as-is rather than walking it as a
 * malformed tiptap node and producing empty output.
 *
 * `opts.nodeAdapters` lets callers supply per-nodeType serialisers —
 * the admin post-form passes the registry populated by
 * `installAdminTiptapNodeHtml` so that plugin-registered embed nodes
 * (e.g. `amplessYoutube`) are serialised to placeholder div strings
 * instead of falling through with empty children. Callers that omit
 * `opts` get the original behaviour unchanged.
 */
export function tiptapToHtml(
  doc: unknown,
  opts?: { nodeAdapters?: TiptapNodeHtmlAdapters },
): string {
  if (typeof doc === 'string') return doc
  return renderTiptapString(doc as TiptapNode, opts)
}

/** Convert markdown to HTML using marked + GFM. */
export function markdownToHtml(md: string): string {
  return renderMarkdownString(md)
}

/**
 * Walk a tiptap doc and emit Markdown. Mirrors `renderTiptapString` in
 * shape but produces markdown syntax. Loses anything markdown can't
 * express (data attributes, image display modes, custom marks).
 *
 * `opts.nodeAdapters` lets callers supply per-nodeType serialisers —
 * the admin post-form passes the registry populated by
 * `installAdminTiptapNodeMarkdown` so that plugin-registered embed nodes
 * (e.g. `amplessYoutube`) are serialised to bare URL lines instead of
 * falling through with empty children. Callers that omit `opts` get the
 * original behaviour unchanged.
 *
 * Notes on info loss:
 * - underline / highlight are not in GFM, so they fall back to the
 *   literal `<u>` / `<mark>` HTML tags (preserved as-is across round trips).
 * - paragraph / heading textAlign cannot be expressed in markdown and
 *   is therefore lost on conversion.
 *
 * Same defensive path as tiptapToHtml: a string input means tiptap
 * hasn't emitted JSON yet (the body is still the HTML we handed it).
 * Route through htmlToMarkdown so the content survives.
 */
export function tiptapToMarkdown(
  doc: unknown,
  opts?: { nodeAdapters?: TiptapNodeMarkdownAdapters },
): string {
  if (typeof doc === 'string') return htmlToMarkdown(doc)
  const node = doc as TiptapNode
  return tiptapNodeToMarkdown(node, opts ?? {}).trim() + '\n'
}

function tiptapNodeToMarkdown(
  node: TiptapNode,
  opts: { nodeAdapters?: TiptapNodeMarkdownAdapters },
): string {
  // **Adapter first**: if a plugin registered a tiptap→markdown adapter
  // for this nodeType, prefer its output. Atom nodes (e.g. amplessYoutube)
  // would otherwise fall through the default switch with empty children,
  // silently dropping the embed when the operator switches format
  // tiptap → markdown in the admin.
  const adapter = opts.nodeAdapters?.[node.type]
  if (adapter) {
    const out = adapter(node as TiptapRenderNode)
    if (typeof out === 'string') {
      // bare URL lines need surrounding blank lines so they survive as a
      // standalone paragraph — extractSingleUrl on the round-trip side
      // only intercepts single-token paragraphs.
      return '\n' + out + '\n\n'
    }
    // out === null means the adapter explicitly defers to the default
    // switch below (= plugin says "use the built-in handling").
  }

  if (node.type === 'text') {
    let txt = node.text ?? ''
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') txt = `**${txt}**`
      else if (mark.type === 'italic') txt = `*${txt}*`
      else if (mark.type === 'code') txt = `\`${txt}\``
      else if (mark.type === 'strike') txt = `~~${txt}~~`
      else if (mark.type === 'underline') txt = `<u>${txt}</u>`
      else if (mark.type === 'highlight') txt = `<mark>${txt}</mark>`
      else if (mark.type === 'link') txt = `[${txt}](${String(mark.attrs?.href ?? '#')})`
    }
    return txt
  }
  const children = (node.content ?? []).map((c) => tiptapNodeToMarkdown(c, opts)).join('')
  switch (node.type) {
    case 'doc':
      return children
    case 'paragraph':
      return children + '\n\n'
    case 'heading': {
      const level = Math.max(1, Math.min(6, Number(node.attrs?.level ?? 1)))
      return '#'.repeat(level) + ' ' + children + '\n\n'
    }
    case 'bulletList':
      return children + '\n'
    case 'orderedList':
      return children + '\n'
    case 'listItem': {
      const trimmed = children.replace(/\n+$/, '')
      return '- ' + trimmed + '\n'
    }
    case 'codeBlock': {
      const lang = node.attrs?.language ? String(node.attrs.language) : ''
      return '```' + lang + '\n' + children + '\n```\n\n'
    }
    case 'blockquote':
      return (
        children
          .replace(/\n+$/, '')
          .split('\n')
          .map((l) => '> ' + l)
          .join('\n') + '\n\n'
      )
    case 'hardBreak':
      return '  \n'
    case 'horizontalRule':
      return '\n---\n\n'
    case 'image': {
      const src = String(node.attrs?.src ?? '')
      const alt = String(node.attrs?.alt ?? '')
      return `![${alt}](${src})`
    }
    case 'table':
      return tiptapTableToMarkdown(node, opts)
    case 'taskList':
      return children + '\n'
    case 'taskItem': {
      const checked = node.attrs?.checked === true ? 'x' : ' '
      // child は通常 paragraph 等を含むので末尾改行を落とし、複数行は2スペースインデント。
      const inner = children.replace(/\n+$/, '')
      const [first, ...rest] = inner.split('\n')
      const cont = rest.map((l) => (l ? '  ' + l : l)).join('\n')
      return `- [${checked}] ${first ?? ''}${cont ? '\n' + cont : ''}\n`
    }
    default:
      // Unknown node with children: pass the children through, same as
      // the HTML walker. Unknown ATOM node (no children rendered):
      // previously dropped silently — emit a visible placeholder comment
      // instead so the omission is auditable in the markdown output, and
      // warn so plugin authors notice the missing adapter.
      if (children) return children
      // eslint-disable-next-line no-console
      console.warn(
        `[ampless] tiptapToMarkdown: no adapter for node type "${String(node.type)}" — emitting placeholder`,
      )
      // Same blank-line wrapping as the adapter path above, so the
      // comment survives as a standalone paragraph.
      return `\n<!-- ampless:unsupported-node type="${sanitizeNodeTypeForComment(node.type)}" -->\n\n`
  }
}

/**
 * Normalise a node type for embedding inside the unsupported-node HTML
 * comment. A broken body could carry `-->`, quotes, or newlines in
 * `type`, any of which would break out of the comment — restrict to a
 * conservative charset and cap the length.
 */
function sanitizeNodeTypeForComment(type: unknown): string {
  return String(type).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)
}

function tiptapTableToMarkdown(
  node: TiptapNode,
  opts: { nodeAdapters?: TiptapNodeMarkdownAdapters },
): string {
  const rows = node.content ?? []
  if (rows.length === 0) return ''
  const renderedRows: string[][] = []
  let headerIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const cells = row.content ?? []
    const cellTexts = cells.map((c) => {
      const inner = (c.content ?? []).map((n) => tiptapNodeToMarkdown(n, opts)).join('')
      // セル内の改行は GFM 慣行に従い <br> に置換、パイプはエスケープ。
      return inner.replace(/\n+$/, '').replace(/\n/g, '<br>').replace(/\|/g, '\\|')
    })
    renderedRows.push(cellTexts)
    if (headerIdx === -1 && cells.some((c) => c.type === 'tableHeader')) headerIdx = i
  }
  // GFM はヘッダー行必須。tableHeader を含む行がなければ最初の行をヘッダー扱い。
  if (headerIdx === -1) headerIdx = 0
  const header = renderedRows[headerIdx] ?? []
  const body = renderedRows.filter((_, i) => i !== headerIdx)
  const cols = header.length
  const headerLine = '| ' + header.join(' | ') + ' |'
  const sepLine = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |'
  const bodyLines = body.map((r) => {
    const cells = Array.from({ length: cols }, (_, i) => r[i] ?? '')
    return '| ' + cells.join(' | ') + ' |'
  })
  return '\n' + [headerLine, sepLine, ...bodyLines].join('\n') + '\n\n'
}

/**
 * Regex-based HTML -> Markdown converter. Handles the tag set the
 * editor produces (`<p>` `<h1>`-`<h6>` `<strong>` `<em>` `<a>`
 * `<img>` `<ul>` `<ol>` `<li>` `<code>` `<pre>` `<blockquote>` `<hr>`
 * `<br>` `<u>` `<mark>` `<table>` task-list `<ul data-type="taskList">`).
 * Decorative containers like `<div style="text-align:...">` are dropped.
 *
 * Tables are reduced to GFM pipe syntax via convertHtmlTable. Complex
 * nested content inside cells (lists, other tables) is flattened to
 * plain text.
 *
 * Not a full library, there are known limits like nested formatting
 * inside list items potentially merging. Acceptable for a v0.x
 * format-switch convenience; complex HTML round-trips shouldn't be
 * relied on.
 */
export function htmlToMarkdown(html: string): string {
  let md = html
  // table は他の置換より先に処理する（中に <tr> <td> 等を含むため）。
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, inner) => {
    return '\n' + convertHtmlTable(String(inner)) + '\n'
  })
  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => {
    return '\n' + '#'.repeat(Number(level)) + ' ' + String(text).trim() + '\n\n'
  })
  md = md.replace(
    /<pre[^>]*><code[^>]*(?:\sclass="language-([^"]+)")?[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_, lang, code) => {
      return '\n```' + (lang ?? '') + '\n' + String(code) + '\n```\n\n'
    }
  )
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    return (
      '\n' +
      String(content)
        .trim()
        .split('\n')
        .map((l: string) => '> ' + l)
        .join('\n') +
      '\n\n'
    )
  })
  // taskList (data-type="taskList" を持つ ul) を先に処理して通常 ul と区別する。
  md = md.replace(/<ul[^>]*data-type="taskList"[^>]*>([\s\S]*?)<\/ul>/gi, (_, items) => {
    return '\n' + convertHtmlTaskList(String(items)) + '\n'
  })
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, items) => {
    return '\n' + String(items).replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n') + '\n'
  })
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, items) => {
    let i = 1
    return (
      '\n' +
      String(items).replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => `${i++}. $1\n`) +
      '\n'
    )
  })
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n\n')
  md = md.replace(/<br\s*\/?>/gi, '  \n')
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
  md = md.replace(/<img[^>]*?src="([^"]*)"[^>]*?alt="([^"]*)"[^>]*?\/?>/gi, '![$2]($1)')
  md = md.replace(/<img[^>]*?alt="([^"]*)"[^>]*?src="([^"]*)"[^>]*?\/?>/gi, '![$1]($2)')
  md = md.replace(/<img[^>]*?src="([^"]*)"[^>]*?\/?>/gi, '![]($1)')
  md = md.replace(/<a[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
  md = md.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**')
  md = md.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*')
  md = md.replace(/<s>([\s\S]*?)<\/s>/gi, '~~$1~~')
  md = md.replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`')
  // u / mark は GFM 非対応のため HTML タグのまま残す（フォールバック）。
  // 後段の `<\/?[^>]+>` 一掃で消えないよう、衝突しにくいプレースホルダに
  // 一旦置換してから復元する。
  const PH_U_OPEN = 'AMP_U_OPEN'
  const PH_U_CLOSE = 'AMP_U_CLOSE'
  const PH_MARK_OPEN = 'AMP_MARK_OPEN'
  const PH_MARK_CLOSE = 'AMP_MARK_CLOSE'
  md = md.replace(/<u>([\s\S]*?)<\/u>/gi, `${PH_U_OPEN}$1${PH_U_CLOSE}`)
  md = md.replace(/<mark>([\s\S]*?)<\/mark>/gi, `${PH_MARK_OPEN}$1${PH_MARK_CLOSE}`)
  md = md.replace(/<\/?[^>]+>/g, '')
  md = md
    .split(PH_U_OPEN).join('<u>')
    .split(PH_U_CLOSE).join('</u>')
    .split(PH_MARK_OPEN).join('<mark>')
    .split(PH_MARK_CLOSE).join('</mark>')
  md = md
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
  md = md.replace(/\n{3,}/g, '\n\n')
  return md.trim() + '\n'
}

function convertHtmlTable(inner: string): string {
  // thead / tbody は剥がすだけ。
  const stripped = inner.replace(/<\/?(thead|tbody)[^>]*>/gi, '')
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const rows: { isHeader: boolean; cells: string[] }[] = []
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(stripped)) !== null) {
    const rowHtml = m[1] ?? ''
    const cellRe = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi
    const cells: string[] = []
    let isHeader = false
    let cm: RegExpExecArray | null
    while ((cm = cellRe.exec(rowHtml)) !== null) {
      if ((cm[1] ?? '').toLowerCase() === 'th') isHeader = true
      cells.push(normalizeTableCell(cm[2] ?? ''))
    }
    if (cells.length > 0) rows.push({ isHeader, cells })
  }
  if (rows.length === 0) return ''
  let headerIdx = rows.findIndex((r) => r.isHeader)
  if (headerIdx === -1) headerIdx = 0
  const header = rows[headerIdx]!.cells
  const body = rows.filter((_, i) => i !== headerIdx).map((r) => r.cells)
  const cols = header.length
  const headerLine = '| ' + header.join(' | ') + ' |'
  const sepLine = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |'
  const bodyLines = body.map((cells) => {
    const padded = Array.from({ length: cols }, (_, i) => cells[i] ?? '')
    return '| ' + padded.join(' | ') + ' |'
  })
  return [headerLine, sepLine, ...bodyLines].join('\n') + '\n'
}

function normalizeTableCell(html: string): string {
  // セル内の <br> は半角スペース、その他のタグは除去して平文化する。
  // 複雑なネスト（セル内のリスト・別テーブル等）は未対応。
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim()
}

function convertHtmlTaskList(items: string): string {
  // <ul data-type="taskList"> 配下の <li data-type="taskItem" data-checked="...">
  // を `- [x]` / `- [ ]` に変換。
  const liRe = /<li[^>]*data-checked="(true|false)"[^>]*>([\s\S]*?)<\/li>/gi
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = liRe.exec(items)) !== null) {
    const checked = m[1] === 'true' ? 'x' : ' '
    // li の中身は通常 <p>...</p> でラップされる。p タグを剥がし、残り HTML は
    // 呼び出し元（htmlToMarkdown）の後段で素朴な置換に任せる。
    const inner = String(m[2] ?? '').replace(/<\/?p[^>]*>/gi, '').trim()
    out.push(`- [${checked}] ${inner}`)
  }
  return out.join('\n')
}

// ---- AI-readable publishing: post -> canonical Markdown ----

export interface PostToMarkdownOptions {
  /**
   * Per-nodeType tiptap→markdown serialisers (plugin embed nodes →
   * bare URL lines). `createAmpless` injects
   * `pluginHead.markdownAdapters`; a raw direct caller can omit this
   * to fall back to the built-in switch (unknown atom nodes then emit
   * unsupported-node placeholder comments).
   */
  nodeAdapters?: TiptapNodeMarkdownAdapters
  /** Prepend YAML frontmatter (default: true). */
  frontmatter?: boolean
  /**
   * Absolute site origin used to build the frontmatter's `canonical`
   * line (`<siteUrl>/<slug>`). Omitted → no canonical line.
   */
  siteUrl?: string
}

/**
 * Convert a public post into its canonical Markdown representation:
 * YAML frontmatter + format-dependent body. This is the single
 * conversion point for every AI-readable surface (the `/<slug>.md`
 * route, llms-full, public MCP `get_post`) — new surfaces should call
 * this rather than reimplementing the format branches.
 *
 * Frontmatter carries **public fields only** (title / slug /
 * publishedAt / updatedAt / tags / excerpt / canonical) — never
 * postId, status, or metadata. Values are encoded with
 * `JSON.stringify`: a JSON string is a valid YAML double-quoted
 * scalar and a JSON array is a valid YAML flow sequence, so quoting /
 * escaping is correct without a YAML library.
 *
 * Body quality varies by format:
 *   - `markdown`: the stored source, verbatim.
 *   - `tiptap`: `tiptapToMarkdown` with `opts.nodeAdapters` (plugin
 *     embeds become bare URL lines; unknown atom nodes emit an
 *     `ampless:unsupported-node` placeholder comment).
 *   - `html`: `htmlToMarkdown` — regex-based and approximate; complex
 *     markup may not fully survive (see htmlToMarkdown's limits).
 *   - `static`: no body conversion (the bundle bytes live in S3) — a
 *     markdown link to the served entrypoint, plus the excerpt when
 *     present.
 *
 * Pure, synchronous, and node-safe — same tier as `tiptapToMarkdown` /
 * `htmlToMarkdown`. Themes / routes should usually call it through
 * `ampless.postToMarkdown(post)`, which injects the plugin adapter
 * registry and the effective site URL.
 */
export function postToMarkdown(post: Post, opts: PostToMarkdownOptions = {}): string {
  const frontmatter = opts.frontmatter !== false ? postFrontmatter(post, opts.siteUrl) : ''
  return frontmatter + postBodyToMarkdown(post, opts)
}

function postFrontmatter(post: Post, siteUrl: string | undefined): string {
  const lines: string[] = []
  lines.push(`title: ${JSON.stringify(post.title)}`)
  lines.push(`slug: ${JSON.stringify(post.slug)}`)
  if (post.publishedAt) lines.push(`publishedAt: ${JSON.stringify(post.publishedAt)}`)
  if (post.updatedAt) lines.push(`updatedAt: ${JSON.stringify(post.updatedAt)}`)
  if (post.tags && post.tags.length > 0) lines.push(`tags: ${JSON.stringify(post.tags)}`)
  if (post.excerpt) lines.push(`excerpt: ${JSON.stringify(post.excerpt)}`)
  if (siteUrl) {
    // Normalise trailing slashes so `site.url: "https://example.com/"`
    // doesn't produce a `//slug` canonical.
    const origin = siteUrl.replace(/\/+$/, '')
    lines.push(`canonical: ${JSON.stringify(`${origin}/${post.slug}`)}`)
  }
  return `---\n${lines.join('\n')}\n---\n\n`
}

function postBodyToMarkdown(post: Post, opts: PostToMarkdownOptions): string {
  switch (post.format) {
    case 'markdown':
      return typeof post.body === 'string' ? post.body : String(post.body ?? '')
    case 'tiptap':
      // string body falls through to htmlToMarkdown inside
      // tiptapToMarkdown (format-switch save path).
      return tiptapToMarkdown(post.body, { nodeAdapters: opts.nodeAdapters })
    case 'html':
      return htmlToMarkdown(String(post.body))
    case 'static': {
      const link = `[${staticEntrypoint(post.body)}](/${post.slug}/)`
      return post.excerpt ? `${link}\n\n${post.excerpt}\n` : `${link}\n`
    }
    default:
      return ''
  }
}

/**
 * Resolve the entrypoint out of a `format: 'static'` body manifest.
 * The body is usually an already-decoded `StaticPostBody` object, but a
 * raw JSON string (or a broken body) is tolerated — anything that
 * doesn't parse into a manifest falls back to the default entrypoint.
 */
function staticEntrypoint(body: unknown): string {
  let manifest: unknown = body
  if (typeof manifest === 'string') {
    try {
      manifest = JSON.parse(manifest)
    } catch {
      return 'index.html'
    }
  }
  if (
    typeof manifest === 'object' &&
    manifest !== null &&
    typeof (manifest as { entrypoint?: unknown }).entrypoint === 'string' &&
    (manifest as { entrypoint: string }).entrypoint.length > 0
  ) {
    return (manifest as { entrypoint: string }).entrypoint
  }
  return 'index.html'
}
