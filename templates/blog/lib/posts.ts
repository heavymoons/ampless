import type { Post } from 'ampless'

// Minimal markdown -> HTML renderer for the default dummy content.
// Phase 4 will replace this with a proper renderer (markdown-it / @tiptap/html).
function renderMarkdown(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

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
        items.push(`<li>${renderInline((lines[i] ?? '').slice(2))}</li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
    } else if (line.trim() === '') {
      i++
    } else {
      out.push(`<p>${renderInline(line)}</p>`)
      i++
    }
  }
  return out.join('\n')
}

function renderInline(text: string): string {
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

export function renderBody(post: Post): string {
  if (post.format === 'html') return String(post.body)
  if (post.format === 'markdown') return renderMarkdown(String(post.body))
  // tiptap: simple stub; Phase 4 will use @tiptap/html generateHTML
  return `<pre>${JSON.stringify(post.body, null, 2)}</pre>`
}
