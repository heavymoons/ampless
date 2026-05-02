import type { Post } from 'ampless'

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

function renderTiptap(node: TiptapNode): string {
  if (node.type === 'text') {
    let html = escape(node.text ?? '')
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') html = `<strong>${html}</strong>`
      else if (mark.type === 'italic') html = `<em>${html}</em>`
      else if (mark.type === 'code') html = `<code>${html}</code>`
      else if (mark.type === 'strike') html = `<s>${html}</s>`
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
      return `<p>${children}</p>`
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      return `<h${level}>${children}</h${level}>`
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
    default:
      return children
  }
}

function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.startsWith('# ')) {
      out.push(`<h1>${escape(line.slice(2))}</h1>`)
      i++
    } else if (line.startsWith('## ')) {
      out.push(`<h2>${escape(line.slice(3))}</h2>`)
      i++
    } else if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const code: string[] = []
      i++
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        code.push(lines[i] ?? '')
        i++
      }
      i++
      out.push(
        `<pre><code${lang ? ` class="language-${escape(lang)}"` : ''}>${escape(code.join('\n'))}</code></pre>`
      )
    } else if (line.startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && (lines[i] ?? '').startsWith('- ')) {
        items.push(`<li>${renderInlineMarkdown((lines[i] ?? '').slice(2))}</li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
    } else if (line.trim() === '') {
      i++
    } else {
      out.push(`<p>${renderInlineMarkdown(line)}</p>`)
      i++
    }
  }
  return out.join('\n')
}

function renderInlineMarkdown(text: string): string {
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

export function renderBody(post: Post): string {
  // 仕様: editor は信頼された主体。`'html'` フォーマットは body をその
  // ままレンダリングする (任意 HTML / script 可)。ファイル冒頭のコメント
  // および 04-access-layer-mcp.md を参照。
  if (post.format === 'html') return String(post.body)
  if (post.format === 'markdown') return renderMarkdown(String(post.body))
  if (post.format === 'tiptap') return renderTiptap(post.body as TiptapNode)
  return ''
}

// --- Format converters ---
//
// Used by the admin post form to preserve the user's work when they
// switch format mid-edit. Round-trips are best-effort: tiptap → html
// is exact, the others approximate. Tables, complex inline marks,
// and tiptap-specific attributes (image display modes etc.) may not
// survive a markdown trip.

/** Convert a tiptap doc to its HTML form. Same renderer the public site uses. */
export function tiptapToHtml(doc: unknown): string {
  return renderTiptap(doc as TiptapNode)
}

/** Convert markdown to HTML using the built-in minimal renderer. */
export function markdownToHtml(md: string): string {
  return renderMarkdown(md)
}

/**
 * Walk a tiptap doc and emit Markdown. Mirrors `renderTiptap` in
 * shape but produces markdown syntax. Loses anything markdown can't
 * express (data attributes, image display modes, custom marks).
 */
export function tiptapToMarkdown(doc: unknown): string {
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
    default:
      return children
  }
}

/**
 * Regex-based HTML → Markdown converter. Handles the tag set the
 * editor produces (`<p>` `<h1>`-`<h6>` `<strong>` `<em>` `<a>`
 * `<img>` `<ul>` `<ol>` `<li>` `<code>` `<pre>` `<blockquote>` `<hr>`
 * `<br>`). Anything else (tables, sections, divs) keeps its content
 * but loses structural meaning.
 *
 * Not a full library — there are known limits like nested formatting
 * inside list items potentially merging. Acceptable for a v0.x
 * format-switch convenience; complex HTML round-trips shouldn't be
 * relied on.
 */
export function htmlToMarkdown(html: string): string {
  let md = html
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
  md = md.replace(/<\/?[^>]+>/g, '')
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
