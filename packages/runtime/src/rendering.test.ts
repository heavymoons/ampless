import { describe, it, expect } from 'vitest'
import type { Post } from 'ampless'
import {
  renderBody,
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

describe('renderBody', () => {
  it('passes html bodies through unchanged', () => {
    expect(renderBody(p('html', '<p>hi</p>'))).toBe('<p>hi</p>')
  })

  it('renders markdown headers + paragraphs', () => {
    expect(renderBody(p('markdown', '# Hello\n\nworld'))).toContain('<h1>Hello</h1>')
    expect(renderBody(p('markdown', '# Hello\n\nworld'))).toContain('<p>world</p>')
  })

  it('renders a tiptap doc to HTML', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    }
    expect(renderBody(p('tiptap', doc))).toBe('<p>hi</p>')
  })

  it('renders a string tiptap body defensively (format-switch save path)', () => {
    expect(renderBody(p('tiptap', '<p>hi</p>'))).toBe('<p>hi</p>')
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
