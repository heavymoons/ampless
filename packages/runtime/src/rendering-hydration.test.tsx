// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, type ReactElement, type ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Post } from 'ampless'
import { renderBody } from './rendering.js'

// Regression test for the PR #312 review finding: client plugins
// (@ampless/plugin-mermaid, @ampless/plugin-highlight) mutate the rendered
// post body BEFORE React finishes hydrating. mermaid replaces the whole
// <pre> code block with a <div class="ampless-mermaid"> SVG; highlight
// injects <span> nodes into the <code>.
//
// For tiptap bodies the code block used to be a React-managed <pre>, so
// mermaid's element replacement was a structural (element-type) hydration
// mismatch that suppressHydrationWarning can't cover — React 19 regenerates
// the subtree back to <pre><code>, deleting the plugin's SVG. The fix
// renders tiptap code blocks as an opaque dangerouslySetInnerHTML island
// (same model as markdown/html bodies), which React never traverses, so the
// plugin's mutation survives.
//
// jsdom + React 19 may or may not emit a catchable console.error for the
// structural mismatch, so the PRIMARY assertion is the user-visible signal:
// the plugin-mutated DOM SURVIVES hydration (the .ampless-mermaid div / the
// injected span is still present, NOT reverted to <pre>). We additionally
// assert no hydration-mismatch console.error fired.

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

const HYDRATION_MISMATCH_RE = /hydrat|did not match|server.*client|server-rendered/i

interface HydrateResult {
  container: HTMLDivElement
  errors: string[]
}

/**
 * Server-render `post`'s body, drop the SSR HTML into a detached container,
 * let `mutate` rewrite the DOM (simulating a client plugin that runs before
 * hydration), then hydrate the SAME React element onto the mutated DOM while
 * capturing console.error output.
 */
function renderMutateHydrate(
  post: Post,
  mutate: (container: HTMLDivElement) => void
): HydrateResult {
  const el = renderBody(post) as ReactElement
  const serverHtml = renderToStaticMarkup(el)

  const container = document.createElement('div')
  container.innerHTML = serverHtml
  document.body.appendChild(container)

  // Simulate the client plugin mutating the SSR DOM before hydration.
  mutate(container)

  const errors: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(' '))
  })

  try {
    act(() => {
      hydrateRoot(container, el as ReactNode)
    })
  } finally {
    spy.mockRestore()
  }

  // Note: the hydrated root is intentionally not unmounted here — we assert
  // on the post-hydration DOM in `container`. afterEach clears document.body.

  return { container, errors }
}

function hasHydrationMismatch(errors: string[]): boolean {
  return errors.some((e) => HYDRATION_MISMATCH_RE.test(e))
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('post body survives client-plugin DOM mutation across hydration', () => {
  it('tiptap mermaid: plugin <pre>→.ampless-mermaid replacement is preserved (the PR #312 bug)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'mermaid' },
          content: [{ type: 'text', text: 'pie title X' }],
        },
      ],
    }

    const { container, errors } = renderMutateHydrate(p('tiptap', doc), (c) => {
      const pre = c.querySelector('pre')
      expect(pre).not.toBeNull()
      const div = document.createElement('div')
      div.className = 'ampless-mermaid'
      div.innerHTML = '<svg></svg>'
      pre!.replaceWith(div)
    })

    // Primary signal: the plugin's mermaid output survives hydration — React
    // does NOT regenerate the subtree back to <pre>.
    expect(container.querySelector('.ampless-mermaid')).not.toBeNull()
    expect(container.querySelector('.ampless-mermaid svg')).not.toBeNull()
    expect(container.querySelector('pre')).toBeNull()
    // Secondary signal: no structural hydration-mismatch warning.
    expect(hasHydrationMismatch(errors)).toBe(false)
  })

  it('tiptap highlight: spans injected into <code> are preserved', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const x = 1' }],
        },
      ],
    }

    const { container, errors } = renderMutateHydrate(p('tiptap', doc), (c) => {
      const code = c.querySelector('pre code')
      expect(code).not.toBeNull()
      const span = document.createElement('span')
      span.className = 'hljs-keyword'
      span.textContent = 'const'
      code!.prepend(span)
    })

    // Primary signal: the injected highlight span survives hydration.
    expect(container.querySelector('code .hljs-keyword')).not.toBeNull()
    expect(container.querySelector('code .hljs-keyword')!.textContent).toBe('const')
    // Secondary signal: no hydration-mismatch warning.
    expect(hasHydrationMismatch(errors)).toBe(false)
  })

  it('markdown mermaid (baseline): plugin <pre>→.ampless-mermaid replacement is preserved', () => {
    // markdown bodies already render as an opaque dangerouslySetInnerHTML
    // island — this guards against a regression in the markdown path.
    const md = '```mermaid\npie title X\n```'

    const { container, errors } = renderMutateHydrate(p('markdown', md), (c) => {
      const pre = c.querySelector('pre')
      expect(pre).not.toBeNull()
      const div = document.createElement('div')
      div.className = 'ampless-mermaid'
      div.innerHTML = '<svg></svg>'
      pre!.replaceWith(div)
    })

    expect(container.querySelector('.ampless-mermaid')).not.toBeNull()
    expect(container.querySelector('.ampless-mermaid svg')).not.toBeNull()
    expect(container.querySelector('pre')).toBeNull()
    expect(hasHydrationMismatch(errors)).toBe(false)
  })
})
