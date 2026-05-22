import type { Post } from 'ampless'
import { marked } from 'marked'

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

function renderTiptap(node: TiptapNode): string {
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

  const children = (node.content ?? []).map(renderTiptap).join('')

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

function renderMarkdown(md: string): string {
  // marked v14: parse は async: false で同期実行できるが、型は
  // `string | Promise<string>` を返すため as string でキャストする。
  // sanitize は v14 で廃止。出力は信頼境界として扱う既存方針を維持。
  return marked.parse(md, { gfm: true, breaks: false, async: false }) as string
}

export function renderBody(post: Post): string {
  // 仕様: editor は信頼された主体。`'html'` フォーマットは body をその
  // ままレンダリングする (任意 HTML / script 可)。ファイル冒頭のコメント
  // および 04-access-layer-mcp.md を参照。
  if (post.format === 'html') return String(post.body)
  if (post.format === 'markdown') return renderMarkdown(String(post.body))
  if (post.format === 'tiptap') {
    // Defensive: a tiptap-formatted post may have its body persisted
    // as a raw HTML string if the admin saved straight after a
    // format-switch sequence (markdown -> tiptap -> save without
    // editing). Treat string bodies as already-rendered HTML rather
    // than crashing into empty output.
    if (typeof post.body === 'string') return post.body
    return renderTiptap(post.body as TiptapNode)
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
 */
export function tiptapToHtml(doc: unknown): string {
  if (typeof doc === 'string') return doc
  return renderTiptap(doc as TiptapNode)
}

/** Convert markdown to HTML using marked + GFM. */
export function markdownToHtml(md: string): string {
  return renderMarkdown(md)
}

/**
 * Walk a tiptap doc and emit Markdown. Mirrors `renderTiptap` in
 * shape but produces markdown syntax. Loses anything markdown can't
 * express (data attributes, image display modes, custom marks).
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
export function tiptapToMarkdown(doc: unknown): string {
  if (typeof doc === 'string') return htmlToMarkdown(doc)
  const node = doc as TiptapNode
  return tiptapNodeToMarkdown(node).trim() + '\n'
}

function tiptapNodeToMarkdown(node: TiptapNode): string {
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
  const children = (node.content ?? []).map(tiptapNodeToMarkdown).join('')
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
      return tiptapTableToMarkdown(node)
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
      return children
  }
}

function tiptapTableToMarkdown(node: TiptapNode): string {
  const rows = node.content ?? []
  if (rows.length === 0) return ''
  const renderedRows: string[][] = []
  let headerIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const cells = row.content ?? []
    const cellTexts = cells.map((c) => {
      const inner = (c.content ?? []).map(tiptapNodeToMarkdown).join('')
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
