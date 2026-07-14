import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { isValidElement, type ReactNode } from 'react'
import type { AmplessPlugin, Post } from 'ampless'
import {
  renderBody,
  renderBodyHtmlString,
  markdownToHtml,
  htmlToMarkdown,
  tiptapToHtml,
  tiptapToMarkdown,
  postToMarkdown,
  buildMarkdownAdapterRegistry,
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

  it('tiptap code block renders as a suppressed dangerouslySetInnerHTML island', () => {
    // The codeBlock is now an opaque island (a <div> with
    // dangerouslySetInnerHTML + suppressHydrationWarning) rather than a
    // React-managed <pre>, so client plugins (mermaid replacing the <pre>,
    // highlight injecting spans) can mutate it without React regenerating
    // the subtree. The inner <pre><code class="language-…"> source is
    // preserved verbatim inside the island's __html.
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
    const found = someElement(renderBody(p('tiptap', doc)), (el) => {
      const props = el.props as Record<string, unknown>
      const dsi = props.dangerouslySetInnerHTML as { __html?: string } | undefined
      return (
        Boolean(dsi) &&
        props.suppressHydrationWarning === true &&
        typeof dsi?.__html === 'string' &&
        dsi.__html.includes('<pre><code class="language-mermaid">')
      )
    })
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

  it('no opts: unknown atom node emits an unsupported-node placeholder (not silent drop)', () => {
    // amplessYoutube is an atom node — without an adapter it has no
    // content, so the default switch used to drop it silently. It now
    // emits a placeholder comment so the omission stays auditable.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const doc = makeDoc('amplessYoutube', { videoId: 'abc' })
      const md = tiptapToMarkdown(doc)
      // Still does NOT contain the video id — only the placeholder.
      expect(md).not.toContain('abc')
      expect(md).toContain('<!-- ampless:unsupported-node type="amplessYoutube" -->')
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
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

// --- postToMarkdown: canonical post -> Markdown conversion ---

describe('postToMarkdown', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  // Richer fixture than p(): postToMarkdown reads the frontmatter
  // fields (publishedAt / tags / excerpt / updatedAt) that p() omits.
  function post(overrides: Partial<Post> & Pick<Post, 'format' | 'body'>): Post {
    return {
      postId: 'p1',
      slug: 'hello-world',
      title: 'Hello World',
      status: 'published',
      ...overrides,
    }
  }

  describe('tiptap body', () => {
    it('converts standard nodes (heading / list / table / quote / link / image / code block)', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section' }] },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item one' }] }],
              },
            ],
          },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableHeader',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
                  },
                ],
              },
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableCell',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }],
                  },
                ],
              },
            ],
          },
          {
            type: 'blockquote',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'a link',
                marks: [{ type: 'link', attrs: { href: 'https://example.com/x' } }],
              },
            ],
          },
          { type: 'image', attrs: { src: '/img.png', alt: 'pic' } },
          {
            type: 'codeBlock',
            attrs: { language: 'ts' },
            content: [{ type: 'text', text: 'const x = 1' }],
          },
        ],
      }
      const md = postToMarkdown(post({ format: 'tiptap', body: doc }), { frontmatter: false })
      expect(md).toContain('## Section')
      expect(md).toContain('- item one')
      expect(md).toContain('| A |')
      expect(md).toContain('| --- |')
      expect(md).toContain('| 1 |')
      expect(md).toContain('> quoted')
      expect(md).toContain('[a link](https://example.com/x)')
      expect(md).toContain('![pic](/img.png)')
      expect(md).toContain('```ts\nconst x = 1\n```')
    })

    it('passes mermaid code fences through', () => {
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
      const md = postToMarkdown(post({ format: 'tiptap', body: doc }), { frontmatter: false })
      expect(md).toContain('```mermaid\ngraph TD; A-->B\n```')
    })

    it('serialises plugin embed nodes to bare URL lines via nodeAdapters', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'intro' }] },
          { type: 'amplessTweet', attrs: { tweetUrl: 'https://x.com/a/status/123' } },
          { type: 'amplessYoutube', attrs: { videoId: 'dQw4w9WgXcQ' } },
        ],
      }
      const md = postToMarkdown(post({ format: 'tiptap', body: doc }), {
        frontmatter: false,
        nodeAdapters: {
          amplessTweet: (node) => String(node.attrs?.tweetUrl ?? '') || null,
          amplessYoutube: (node) => {
            const id = String(node.attrs?.videoId ?? '')
            return id ? `https://youtu.be/${id}` : null
          },
        },
      })
      expect(md).toContain('https://x.com/a/status/123')
      expect(md).toContain('https://youtu.be/dQw4w9WgXcQ')
      expect(md).not.toContain('unsupported-node')
    })

    it('emits a placeholder comment + console.warn for an unknown atom node', () => {
      const doc = {
        type: 'doc',
        content: [{ type: 'amplessTweet', attrs: { tweetUrl: 'https://x.com/a/status/1' } }],
      }
      const md = postToMarkdown(post({ format: 'tiptap', body: doc }), { frontmatter: false })
      expect(md).toContain('<!-- ampless:unsupported-node type="amplessTweet" -->')
      expect(
        warnSpy.mock.calls.some((c: unknown[]) =>
          String(c[0]).includes('no adapter for node type "amplessTweet"'),
        ),
      ).toBe(true)
    })

    it('passes children of an unknown non-atom node through unchanged', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'mysteryWrapper',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inner' }] }],
          },
        ],
      }
      const md = postToMarkdown(post({ format: 'tiptap', body: doc }), { frontmatter: false })
      expect(md).toContain('inner')
      expect(md).not.toContain('unsupported-node')
    })

    it('normalises hostile node types in the placeholder so the comment cannot break', () => {
      const doc = {
        type: 'doc',
        content: [{ type: 'evil --> <script>\nalert(1)' }],
      }
      const md = postToMarkdown(post({ format: 'tiptap', body: doc }), { frontmatter: false })
      // Spaces, angle brackets, and newlines are all replaced (`-` itself
      // is allowed, but `-->` can never survive because `>` is not).
      expect(md).toContain('<!-- ampless:unsupported-node type="evil_--___script__alert_1_" -->')
      expect(md).not.toContain('--> <script>')
    })

    it('truncates overlong node types in the placeholder to 64 chars', () => {
      const longType = 'x'.repeat(100)
      const doc = { type: 'doc', content: [{ type: longType }] }
      const md = postToMarkdown(post({ format: 'tiptap', body: doc }), { frontmatter: false })
      expect(md).toContain(`type="${'x'.repeat(64)}"`)
      expect(md).not.toContain('x'.repeat(65))
    })

    it('routes a string tiptap body through htmlToMarkdown (format-switch save path)', () => {
      const md = postToMarkdown(
        post({ format: 'tiptap', body: '<h1>Hi</h1><p>there</p>' }),
        { frontmatter: false },
      )
      expect(md).toContain('# Hi')
      expect(md).toContain('there')
    })
  })

  describe('other formats', () => {
    it('returns a markdown body verbatim', () => {
      const src = '# Title\n\nsome **bold** text\n'
      expect(postToMarkdown(post({ format: 'markdown', body: src }), { frontmatter: false })).toBe(src)
    })

    it('converts an html body via htmlToMarkdown (approximate)', () => {
      const md = postToMarkdown(
        post({ format: 'html', body: '<h2>Sub</h2><p><strong>bold</strong></p>' }),
        { frontmatter: false },
      )
      expect(md).toContain('## Sub')
      expect(md).toContain('**bold**')
    })

    it('renders a static post as an entrypoint link + excerpt', () => {
      const md = postToMarkdown(
        post({
          format: 'static',
          slug: 'my-app',
          excerpt: 'A tiny app.',
          body: { entrypoint: 'index.html', files: ['index.html'], uploadedAt: '2026-01-01T00:00:00Z' },
        }),
        { frontmatter: false },
      )
      expect(md).toBe('[index.html](/my-app/)\n\nA tiny app.\n')
    })

    it('falls back to the default entrypoint link for a broken static body', () => {
      const md = postToMarkdown(
        post({ format: 'static', slug: 'my-app', body: 'not json {' }),
        { frontmatter: false },
      )
      expect(md).toBe('[index.html](/my-app/)\n')
    })
  })

  describe('frontmatter', () => {
    it('emits every public field and nothing internal', () => {
      const md = postToMarkdown(
        post({
          format: 'markdown',
          body: 'body\n',
          excerpt: 'the excerpt',
          publishedAt: '2026-07-01T00:00:00Z',
          updatedAt: '2026-07-02T00:00:00Z',
          tags: ['a', 'b'],
          metadata: { cache: 'hot', secretish: 'x' },
        }),
        { siteUrl: 'https://example.com' },
      )
      expect(md.startsWith('---\n')).toBe(true)
      expect(md).toContain('title: "Hello World"')
      expect(md).toContain('slug: "hello-world"')
      expect(md).toContain('publishedAt: "2026-07-01T00:00:00Z"')
      expect(md).toContain('updatedAt: "2026-07-02T00:00:00Z"')
      expect(md).toContain('tags: ["a","b"]')
      expect(md).toContain('excerpt: "the excerpt"')
      expect(md).toContain('canonical: "https://example.com/hello-world"')
      // Internal fields never leak.
      expect(md).not.toContain('postId')
      expect(md).not.toContain('published\n') // no bare status line
      expect(md).not.toContain('status:')
      expect(md).not.toContain('secretish')
      expect(md).not.toContain('metadata')
      // Body follows after the closing fence + blank line.
      expect(md).toContain('---\n\nbody\n')
    })

    it('omits optional fields that are absent', () => {
      const md = postToMarkdown(post({ format: 'markdown', body: 'b\n' }))
      expect(md).toContain('title: "Hello World"')
      expect(md).toContain('slug: "hello-world"')
      expect(md).not.toContain('publishedAt:')
      expect(md).not.toContain('updatedAt:')
      expect(md).not.toContain('tags:')
      expect(md).not.toContain('excerpt:')
      expect(md).not.toContain('canonical:')
    })

    it('omits the tags line when tags is an empty array', () => {
      const md = postToMarkdown(post({ format: 'markdown', body: 'b\n', tags: [] }))
      expect(md).not.toContain('tags:')
    })

    it('frontmatter: false returns only the body', () => {
      const md = postToMarkdown(
        post({ format: 'markdown', body: '# only body\n' }),
        { frontmatter: false },
      )
      expect(md).toBe('# only body\n')
    })

    it('JSON-encodes hostile values (quotes / colons / newlines / non-ASCII)', () => {
      const md = postToMarkdown(
        post({
          format: 'markdown',
          body: 'b\n',
          title: 'He said: "yes" --- \nnewline 日本語',
          excerpt: 'line1\nline2',
        }),
      )
      expect(md).toContain('title: "He said: \\"yes\\" --- \\nnewline 日本語"')
      expect(md).toContain('excerpt: "line1\\nline2"')
      // The raw newline must not split the frontmatter line.
      const fm = md.slice(0, md.indexOf('---\n\n', 4))
      expect(fm.split('\n').filter((l) => l.startsWith('title:'))).toHaveLength(1)
    })

    it('normalises trailing slashes on siteUrl for the canonical line', () => {
      const md = postToMarkdown(
        post({ format: 'markdown', body: 'b\n' }),
        { siteUrl: 'https://example.com///' },
      )
      expect(md).toContain('canonical: "https://example.com/hello-world"')
    })

    it('omits the canonical line when siteUrl is absent', () => {
      const md = postToMarkdown(post({ format: 'markdown', body: 'b\n' }))
      expect(md).not.toContain('canonical:')
    })
  })
})

// --- buildMarkdownAdapterRegistry ---

describe('buildMarkdownAdapterRegistry', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  function plugin(
    name: string,
    adapters?: Record<string, unknown>,
    instanceId?: string,
  ): AmplessPlugin {
    return {
      name,
      apiVersion: 1,
      trust_level: 'untrusted',
      ...(instanceId ? { instanceId } : {}),
      ...(adapters ? { tiptapNodeToMarkdown: adapters } : {}),
    } as AmplessPlugin
  }

  it('merges adapters across plugins', () => {
    const tweet = () => 'tweet'
    const youtube = () => 'youtube'
    const registry = buildMarkdownAdapterRegistry([
      plugin('x', { amplessTweet: tweet }),
      plugin('youtube', { amplessYoutube: youtube }),
    ])
    expect(registry.amplessTweet).toBe(tweet)
    expect(registry.amplessYoutube).toBe(youtube)
  })

  it('throws on a nodeType claimed by two different functions', () => {
    expect(() =>
      buildMarkdownAdapterRegistry([
        plugin('a', { amplessTweet: () => 'a' }),
        plugin('b', { amplessTweet: () => 'b' }),
      ]),
    ).toThrow(/duplicate tiptap nodeType "amplessTweet"/)
  })

  it('tolerates the same function reference registered twice', () => {
    const shared = () => 'shared'
    const registry = buildMarkdownAdapterRegistry([
      plugin('a', { amplessTweet: shared }),
      plugin('b', { amplessTweet: shared }),
    ])
    expect(registry.amplessTweet).toBe(shared)
  })

  it('skips plugins without a tiptapNodeToMarkdown map', () => {
    const registry = buildMarkdownAdapterRegistry([plugin('no-adapters')])
    expect(Object.keys(registry)).toHaveLength(0)
  })

  it('skips non-function entries with a warning', () => {
    const good = () => 'ok'
    const registry = buildMarkdownAdapterRegistry([
      plugin('broken', { bad: 'not-a-function', good }, 'broken-1'),
    ])
    expect(registry.bad).toBeUndefined()
    expect(registry.good).toBe(good)
    expect(
      warnSpy.mock.calls.some(
        (c: unknown[]) =>
          String(c[0]).includes('non-function tiptapNodeToMarkdown entry for nodeType "bad"') &&
          String(c[0]).includes('"broken-1"'),
      ),
    ).toBe(true)
  })
})
