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
  // ままレンダリングする（任意 HTML / script 可）。ファイル冒頭のコメント
  // および 04-access-layer-mcp.md を参照。
  if (post.format === 'html') return String(post.body)
  if (post.format === 'markdown') return renderMarkdown(String(post.body))
  if (post.format === 'tiptap') return renderTiptap(post.body as TiptapNode)
  return ''
}
