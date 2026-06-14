import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { isValidElement, type ReactNode } from 'react'
import type { Post } from 'ampless'
import {
  renderBody,
  renderBodyHtmlString,
  markdownToHtml,
  htmlToMarkdown,
  tiptapToHtml,
  tiptapToMarkdown,
} from './rendering.js'

function p(format: Post['format'], body: unknown): Post {
  return {
    postId: '1',
    slug: 's',
    title: 't',
    format,
    body,
    status: 'published',
    tags: [],
  }
}

// Helper: render a Post body to its static-markup string. Used to
// assert structural HTML output of the async-ReactNode `renderBody`
// from a sync test body.
function renderToHtml(post: Post): string {
  return renderToStaticMarkup(renderBody(post) as React.ReactElement)
}

describe('renderBody (ReactNode)', () => {
  it('passes html bodies through as raw HTML', () => {
    expect(renderToHtml(p('html', '<p>hi</p>'))).toContain('<p>hi</p>')
  })

  it('renders markdown headers + paragraphs', () => {
    const html = renderToHtml(p('markdown', '# Hello\n\nworld'))
    expect(html).toContain('<h1>Hello</h1>')
    expect(html).toContain('<p>world</p>')
  })

  it('renders a tiptap doc to HTML', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    }
    expect(renderToHtml(p('tiptap', doc))).toContain('<p>')
    expect(renderToHtml(p('tiptap', doc))).toContain('hi')
  })

  it('renders a string tiptap body defensively (format-switch save path)', () => {
    expect(renderToHtml(p('tiptap', '<p>hi</p>'))).toContain('<p>hi</p>')
  })
})

// `suppressHydrationWarning` is stripped by renderToStaticMarkup, so assert
// it on the React element tree instead of the markup string. It lets
// client plugins (mermaid/highlight) rewrite the post body after load
// without React warning about an SSR/DOM mismatch.
function someElement(node: ReactNode, test: (el: React.ReactElement) => boolean): boolean {
  if (Array.isArray(node)) return node.some((n) => someElement(n as ReactNode, test))
  if (!isValidElement(node)) return false
  const el = node as React.ReactElement<{ children?: ReactNode }>
  if (test(el)) return true
  const children = el.props?.children
  return children !== undefined ? someElement(children, test) : false
}

describe('renderBody suppresses hydration warnings on client-enhanced body', () => {
  const hasSuppressedInnerHtml = (el: React.ReactElement) => {
    const props = el.props as Record<string, unknown>
    return Boolean(props.dangerouslySetInnerHTML) && props.suppressHydrationWarning === true
  }

  it('html passthrough body carries suppressHydrationWarning', () => {
    expect(someElement(renderBody(p('html', '<p>hi</p>')), hasSuppressedInnerHtml)).toBe(true)
  })

  it('markdown passthrough body carries suppressHydrationWarning', () => {
    expect(someElement(renderBody(p('markdown', '# Hi')), hasSuppressedInnerHtml)).toBe(true)
  })

  it('tiptap code block <pre> carries suppressHydrationWarning', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'mermaid' },
          content: [{ type: 'text', text: 'graph TD; A-->B' }],
        },
      ],
    }
    const found = someElement(
      renderBody(p('tiptap', doc)),
      (el) => el.type === 'pre' && (el.props as Record<string, unknown>).suppressHydrationWarning === true,
    )
    expect(found).toBe(true)
  })
})

describe('renderBodyHtmlString (sync compat)', () => {
  it('returns html bodies unchanged', () => {
    expect(renderBodyHtmlString(p('html', '<p>hi</p>'))).toBe('<p>hi</p>')
  })

  it('returns marked-style HTML for markdown', () => {
    expect(renderBodyHtmlString(p('markdown', '# Hello'))).toContain('<h1>Hello</h1>')
  })

  it('returns tiptap-rendered HTML for tiptap docs', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    }
    expect(renderBodyHtmlString(p('tiptap', doc))).toBe('<p>hi</p>')
  })

  it('returns string tiptap body unchanged (format-switch save path)', () => {
    expect(renderBodyHtmlString(p('tiptap', '<p>hi</p>'))).toBe('<p>hi</p>')
  })
})

describe('markdown <-> html round trips', () => {
  it('htmlToMarkdown handles headings and paragraphs', () => {
    const md = htmlToMarkdown('<h1>Hi</h1><p>there</p>')
    expect(md).toContain('# Hi')
    expect(md).toContain('there')
  })

  it('markdownToHtml + htmlToMarkdown is idempotent on a paragraph', () => {
    const html = markdownToHtml('plain line')
    expect(html).toContain('<p>plain line</p>')
  })
})

describe('tiptapToHtml', () => {
  it('returns the string verbatim when handed a string body', () => {
    expect(tiptapToHtml('<p>a</p>')).toBe('<p>a</p>')
  })

  it('consults nodeAdapters opts: adapter output is returned directly', () => {
    // Verifies the runtime adapter-consultation path — that tiptapToHtml
    // accepts opts.nodeAdapters and calls the adapter for matching nodeTypes.
    // No embed-plugin-specific assumptions; just validates the consultation
    // mechanism is wired correctly.
    const doc = {
      type: 'doc',
      content: [{ type: 'foo', attrs: { x: 'bar' } }],
    }
    const result = tiptapToHtml(doc, { nodeAdapters: { foo: () => '<bar/>' } })
    expect(result).toBe('<bar/>')
  })

  it('consults nodeAdapters opts: empty string is valid adapter output (not treated as null)', () => {
    // The plan constraint: `if (typeof out === 'string') return out` — NOT a
    // truthy check. An adapter that returns '' means "emit nothing for this
    // node", which is distinct from null (= "fall through to default switch").
    const doc = {
      type: 'doc',
      content: [{ type: 'foo', attrs: {} }],
    }
    const result = tiptapToHtml(doc, { nodeAdapters: { foo: () => '' } })
    expect(result).toBe('')
  })

  it('falls through to default switch when adapter returns null', () => {
    // An adapter that returns null means "use the built-in handling".
    // For an unknown type the default switch returns children (empty for atom).
    const doc = {
      type: 'doc',
      content: [{ type: 'unknownAtom', attrs: {} }],
    }
    // null → fall through → default: return children → empty
    const result = tiptapToHtml(doc, { nodeAdapters: { unknownAtom: () => null } })
    expect(result).toBe('')
  })
})

// --- Added: marked-based markdown coverage ---

describe('markdownToHtml (marked + GFM)', () => {
  it('renders GFM tables', () => {
    const html = markdownToHtml('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('renders GFM task lists with checkbox inputs', () => {
    const html = markdownToHtml('- [ ] todo\n- [x] done')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('todo')
    expect(html).toContain('done')
    // checked attribute is present on the done item
    expect(html).toMatch(/checked[^>]*>[^<]*done/)
  })

  it('renders h3 through h6', () => {
    expect(markdownToHtml('### h3')).toContain('<h3>h3</h3>')
    expect(markdownToHtml('#### h4')).toContain('<h4>h4</h4>')
    expect(markdownToHtml('##### h5')).toContain('<h5>h5</h5>')
    expect(markdownToHtml('###### h6')).toContain('<h6>h6</h6>')
  })

  it('renders links', () => {
    expect(markdownToHtml('[text](https://example.com)')).toContain(
      '<a href="https://example.com">text</a>'
    )
  })

  it('renders images', () => {
    const html = markdownToHtml('![alt](/img.png)')
    expect(html).toMatch(/<img\s+src="\/img\.png"\s+alt="alt"/)
  })

  it('renders blockquotes', () => {
    expect(markdownToHtml('> quote')).toContain('<blockquote>')
  })

  it('renders ordered lists', () => {
    const html = markdownToHtml('1. one\n2. two')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<li>two</li>')
  })

  it('renders italics', () => {
    expect(markdownToHtml('*it*')).toContain('<em>it</em>')
  })

  it('renders strikethrough', () => {
    expect(markdownToHtml('~~strike~~')).toContain('<del>strike</del>')
  })

  it('renders horizontal rules', () => {
    expect(markdownToHtml('---')).toContain('<hr>')
  })

  it('renders fenced code blocks with language class', () => {
    const html = markdownToHtml('```ts\nconst x = 1\n```')
    expect(html).toContain('<code class="language-ts">')
  })
})

// --- Added: tiptap -> HTML for new node types ---

describe('tiptapToHtml: new node types', () => {
  it('renders a table with header + body rows', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
                  ],
                },
                {
                  type: 'tableHeader',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: '1' }] },
                  ],
                },
                {
                  type: 'tableCell',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: '2' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const html = tiptapToHtml(doc)
    expect(html).toContain('<table class="tiptap-table">')
    expect(html).toContain('<tr><th><p>A</p></th><th><p>B</p></th></tr>')
    expect(html).toContain('<tr><td><p>1</p></td><td><p>2</p></td></tr>')
  })

  it('renders cell colspan/rowspan/colwidth attrs', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colspan: 2, rowspan: 1, colwidth: [200, 300] },
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const html = tiptapToHtml(doc)
    expect(html).toContain('colspan="2"')
    expect(html).not.toContain('rowspan=')
    expect(html).toContain('style="width: 200px"')
  })

  it('renders task lists', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'done' }] },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'todo' }] },
              ],
            },
          ],
        },
      ],
    }
    const html = tiptapToHtml(doc)
    expect(html).toContain('<ul data-type="taskList">')
    expect(html).toContain('<li data-type="taskItem" data-checked="true">')
    expect(html).toContain('<li data-type="taskItem" data-checked="false">')
  })

  it('renders underline marks', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'underline' }] }],
        },
      ],
    }
    expect(tiptapToHtml(doc)).toBe('<p><u>x</u></p>')
  })

  it('renders highlight marks', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'highlight' }] }],
        },
      ],
    }
    expect(tiptapToHtml(doc)).toBe('<p><mark>x</mark></p>')
  })

  it('renders paragraph textAlign attribute', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [{ type: 'text', text: 'hi' }],
        },
      ],
    }
    expect(tiptapToHtml(doc)).toBe('<p style="text-align: center">hi</p>')
  })

  it('renders heading textAlign attribute', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2, textAlign: 'right' },
          content: [{ type: 'text', text: 'hi' }],
        },
      ],
    }
    expect(tiptapToHtml(doc)).toBe('<h2 style="text-align: right">hi</h2>')
  })

  it('ignores invalid textAlign values', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'javascript:alert(1)' },
          content: [{ type: 'text', text: 'hi' }],
        },
      ],
    }
    expect(tiptapToHtml(doc)).toBe('<p>hi</p>')
  })
})

// --- Added: tiptap -> markdown for new node types ---

describe('tiptapToMarkdown: new node types', () => {
  it('emits GFM pipe table syntax', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
                  ],
                },
                {
                  type: 'tableHeader',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: '1' }] },
                  ],
                },
                {
                  type: 'tableCell',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: '2' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const md = tiptapToMarkdown(doc)
    expect(md).toContain('| A | B |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| 1 | 2 |')
  })

  it('emits GFM task list syntax', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'done' }] },
              ],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'todo' }] },
              ],
            },
          ],
        },
      ],
    }
    const md = tiptapToMarkdown(doc)
    expect(md).toContain('- [x] done')
    expect(md).toContain('- [ ] todo')
  })

  it('falls back to <u> for underline mark', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'underline' }] }],
        },
      ],
    }
    expect(tiptapToMarkdown(doc)).toContain('<u>x</u>')
  })

  it('falls back to <mark> for highlight mark', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'highlight' }] }],
        },
      ],
    }
    expect(tiptapToMarkdown(doc)).toContain('<mark>x</mark>')
  })
})

// --- Added: htmlToMarkdown for new tag set ---

describe('htmlToMarkdown: new tag handling', () => {
  it('converts <table> into GFM pipe syntax', () => {
    const html =
      '<table class="tiptap-table"><tbody>' +
      '<tr><th><p>A</p></th><th><p>B</p></th></tr>' +
      '<tr><td><p>1</p></td><td><p>2</p></td></tr>' +
      '</tbody></table>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('| A | B |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| 1 | 2 |')
  })

  it('preserves <u> tags', () => {
    expect(htmlToMarkdown('<p><u>x</u></p>')).toContain('<u>x</u>')
  })

  it('preserves <mark> tags', () => {
    expect(htmlToMarkdown('<p><mark>x</mark></p>')).toContain('<mark>x</mark>')
  })

  it('converts taskList HTML into GFM checklist', () => {
    const html =
      '<ul data-type="taskList">' +
      '<li data-type="taskItem" data-checked="true"><p>done</p></li>' +
      '<li data-type="taskItem" data-checked="false"><p>todo</p></li>' +
      '</ul>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('- [x] done')
    expect(md).toContain('- [ ] todo')
  })
})

// --- tiptapToMarkdown opts.nodeAdapters ---

describe('tiptapToMarkdown: opts.nodeAdapters', () => {
  const makeDoc = (type: string, attrs?: Record<string, unknown>) => ({
    type: 'doc',
    content: [{ type, attrs }],
  })

  it('no opts (backward compat): unknown atom node falls through with empty children', () => {
    // amplessYoutube is an atom node — without an adapter it has no content,
    // so the default switch falls through with children = '' (= empty string).
    // The resulting trimmed output is effectively empty.
    const doc = makeDoc('amplessYoutube', { videoId: 'abc' })
    const md = tiptapToMarkdown(doc)
    // Should NOT contain the video id — it's silently dropped in the old path.
    expect(md).not.toContain('abc')
  })

  it('adapter returning a string emits a bare URL line wrapped in blank lines (within surrounding content)', () => {
    // Test with surrounding paragraphs to verify blank lines survive
    // (the top-level trim() strips leading/trailing whitespace, so we
    //  need surrounding content to validate the inter-node blank lines).
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
        { type: 'amplessYoutube', attrs: { videoId: 'dQw4w9WgXcQ' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ],
    }
    const md = tiptapToMarkdown(doc, {
      nodeAdapters: {
        amplessYoutube: (node) => {
          const id = String(node.attrs?.videoId ?? '').trim()
          return id ? `https://youtu.be/${id}` : null
        },
      },
    })
    // Bare URL present
    expect(md).toContain('https://youtu.be/dQw4w9WgXcQ')
    // Surrounded by blank lines so extractSingleUrl can pick it up as a
    // standalone paragraph on the round-trip back to tiptap.
    const lines = md.split('\n')
    const urlLineIdx = lines.findIndex((l) => l === 'https://youtu.be/dQw4w9WgXcQ')
    expect(urlLineIdx).toBeGreaterThan(-1)
    expect(lines[urlLineIdx - 1]).toBe('')  // blank line before URL
    expect(lines[urlLineIdx + 1]).toBe('')  // blank line after URL
    // Surrounding paragraphs also present
    expect(md).toContain('before')
    expect(md).toContain('after')
  })

  it('adapter returning null falls through to the default switch (children)', () => {
    // A paragraph node with an adapter that returns null — should use
    // the default paragraph handling (children + \\n\\n).
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      ],
    }
    const md = tiptapToMarkdown(doc, {
      nodeAdapters: {
        // returning null → fall through to default switch
        paragraph: () => null,
      },
    })
    expect(md).toContain('hello')
  })

  it('no opts empty call produces the same output as calling with empty adapter map', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'world' }] },
      ],
    }
    expect(tiptapToMarkdown(doc)).toBe(tiptapToMarkdown(doc, { nodeAdapters: {} }))
  })
})
