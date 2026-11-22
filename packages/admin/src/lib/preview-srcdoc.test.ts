// @vitest-environment jsdom

/**
 * Unit tests for `buildPreviewSrcDoc`.
 *
 * These run in jsdom so we can manipulate `document.head`, `document.body`,
 * and `document.documentElement` the same way the real browser does, then
 * assert the helper's string-surgery output.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { buildPreviewSrcDoc } from './preview-srcdoc.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal server-emitted preview HTML (matches factory output shape). */
function makeServerHtml(fragment = '<p>Hello world</p>'): string {
  return (
    `<!doctype html>` +
    `<html>` +
    `<head>` +
    `<meta charset="utf-8">` +
    `<style id="ampless-preview-base">body { max-width: 65ch; }</style>` +
    `</head>` +
    `<body class="ampless-preview">` +
    `<main class="prose prose-neutral dark:prose-invert max-w-none">${fragment}</main>` +
    `</body>` +
    `</html>`
  )
}

/** Remove all stylesheets + data-* attrs + htmlClass from jsdom after each test. */
function resetDom() {
  // Remove link and style elements from head
  const toRemove = document.querySelectorAll('head link, head style')
  for (const el of toRemove) el.remove()
  // Clear body data-* attributes
  const attrNames = Array.from(document.body.attributes)
    .map((a) => a.name)
    .filter((n) => n.startsWith('data-'))
  for (const name of attrNames) document.body.removeAttribute(name)
  // Clear html element class
  document.documentElement.className = ''
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPreviewSrcDoc', () => {
  beforeEach(() => resetDom())

  it('case 1: same-origin link[rel="stylesheet"] in parent → absolute href injected in srcDoc head', () => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.setAttribute('href', '/_next/static/css/app.css')
    document.head.appendChild(link)

    const result = buildPreviewSrcDoc(makeServerHtml())

    // The absolute href should appear inside a <link> tag after <head>
    expect(result).toContain(`<head><link rel="stylesheet" href="${location.origin}/_next/static/css/app.css">`)
  })

  it('case 1b: cross-origin link[rel="stylesheet"] is skipped, same-origin one kept', () => {
    const external = document.createElement('link')
    external.rel = 'stylesheet'
    external.href = 'https://fonts.example.com/font.css'
    document.head.appendChild(external)
    const own = document.createElement('link')
    own.rel = 'stylesheet'
    own.href = `${location.origin}/own.css`
    document.head.appendChild(own)

    const result = buildPreviewSrcDoc(makeServerHtml())

    expect(result).not.toContain('fonts.example.com')
    expect(result).toContain(`<link rel="stylesheet" href="${location.origin}/own.css">`)
  })

  it('case 1c: only cross-origin links → nothing collected, base fallback kept', () => {
    const external = document.createElement('link')
    external.rel = 'stylesheet'
    external.href = 'https://cdn.example.com/x.css'
    document.head.appendChild(external)

    const result = buildPreviewSrcDoc(makeServerHtml())

    expect(result).not.toContain('cdn.example.com')
    expect(result).toContain('id="ampless-preview-base"')
  })

  it('case 2: inline <style> in parent → content injected into srcDoc head', () => {
    const style = document.createElement('style')
    style.textContent = '.prose { color: red; }'
    document.head.appendChild(style)

    const result = buildPreviewSrcDoc(makeServerHtml())

    expect(result).toContain('<style>.prose { color: red; }</style>')
  })

  it('case 3: when ≥1 stylesheet collected, <style id="ampless-preview-base"> is removed', () => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `${location.origin}/app.css`
    document.head.appendChild(link)

    const result = buildPreviewSrcDoc(makeServerHtml())

    expect(result).not.toContain('id="ampless-preview-base"')
  })

  it('case 4: 0 stylesheets collected → base block is preserved and html is unchanged', () => {
    // No link or style elements added to document.head
    const input = makeServerHtml()
    const result = buildPreviewSrcDoc(input)

    expect(result).toContain('id="ampless-preview-base"')
    // Overall structure is intact
    expect(result).toContain('<head>')
    expect(result).toContain('</html>')
  })

  it('case 5: parent body data-theme and multiple data-* attrs are copied to iframe body tag', () => {
    document.body.setAttribute('data-theme', 'my-blog')
    document.body.setAttribute('data-color-scheme', 'dark')

    const result = buildPreviewSrcDoc(makeServerHtml())

    expect(result).toContain('data-theme="my-blog"')
    expect(result).toContain('data-color-scheme="dark"')
  })

  it('case 5b: data-* already on the server <body> is not copied (no duplicate data-theme)', () => {
    document.body.setAttribute('data-theme', 'admin-parent')
    document.body.setAttribute('data-extra', 'x')
    const serverHtml = makeServerHtml().replace(
      '<body class="ampless-preview">',
      '<body class="ampless-preview" data-theme="blog">',
    )

    const result = buildPreviewSrcDoc(serverHtml)

    expect(result.match(/data-theme=/g)).toHaveLength(1)
    expect(result).toContain('data-theme="blog"')
    expect(result).not.toContain('admin-parent')
    expect(result).toContain('data-extra="x"')
  })

  it('case 6: parent html element class is copied to iframe html tag', () => {
    document.documentElement.className = 'dark'

    const result = buildPreviewSrcDoc(makeServerHtml())

    expect(result).toMatch(/<html[^>]+class="dark"/)
  })

  it('case 7: input with no <head> tag is returned unchanged (defensive)', () => {
    const malformed = '<body><p>No head here</p></body>'
    const result = buildPreviewSrcDoc(malformed)
    expect(result).toBe(malformed)
  })
})
