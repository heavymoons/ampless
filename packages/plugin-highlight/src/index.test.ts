import { describe, it, expect } from 'vitest'
import highlightPlugin from './index.js'

describe('highlightPlugin factory shape', () => {
  const p = highlightPlugin()

  it('exposes the expected manifest fields', () => {
    expect(p.name).toBe('highlight')
    expect(p.apiVersion).toBe(1)
    expect(p.trust_level).toBe('untrusted')
    expect(p.capabilities).toContain('publicHead')
    // Required so the runtime's static-manifest cross-check runs.
    expect(p.packageName).toBe('@ampless/plugin-highlight')
  })
})

describe('highlightPlugin publicHead', () => {
  const descriptors = highlightPlugin().publicHead!({
    site: {} as never,
    setting: () => undefined,
  })

  it('returns exactly one inlineScript descriptor with the stable id', () => {
    expect(descriptors).toHaveLength(1)
    const d = descriptors[0]!
    expect(d.type).toBe('inlineScript')
    if (d.type !== 'inlineScript') throw new Error('expected inlineScript')
    expect(d.id).toBe('ampless-highlight')
  })

  it('body contains the required markers', () => {
    const d = descriptors[0]!
    if (d.type !== 'inlineScript') throw new Error('expected inlineScript')
    const body = d.body
    // mermaid is excluded so the two plugins coexist.
    expect(body).toContain(':not(.language-mermaid)')
    expect(body).toContain('cdn.jsdelivr.net/npm/highlight.js@')
    // hljs ESM CDN url + the styles CSS prefix (theme name resolved at runtime).
    expect(body).toContain('/+esm')
    expect(body).toContain('/styles/')
    expect(body).toContain('MutationObserver')
  })

  it('body wires up color-scheme detection and a FOUC/race-safe swap', () => {
    const d = descriptors[0]!
    if (d.type !== 'inlineScript') throw new Error('expected inlineScript')
    const body = d.body
    // Reads the <html> data-color-scheme attribute...
    expect(body).toContain('data-color-scheme')
    expect(body).toContain('document.documentElement')
    // ...with a matchMedia guard for the OS preference fallback.
    expect(body).toContain('typeof window.matchMedia')
    expect(body).toContain('prefers-color-scheme: dark')
    // Watches <html> attribute mutations to drive a live swap.
    expect(body).toContain("attributeFilter: ['data-color-scheme']")
    expect(body).toContain('swapTheme')
    // FOUC-safe swap: add a new link, on load remove the old one and promote
    // the new one to the stable id.
    expect(body).toContain('ampless-hljs-theme')
    expect(body).toContain('newLink.onload')
    expect(body).toContain("newLink.id = 'ampless-hljs-theme'")
    // Default theme is the 'auto' sentinel embedded as configured.
    expect(body).toContain('var configured = "auto"')
  })
})

function bodyOf(opts: Parameters<typeof highlightPlugin>[0]): string {
  const d = highlightPlugin(opts).publicHead!({
    site: {} as never,
    setting: () => undefined,
  })[0]!
  if (d.type !== 'inlineScript') throw new Error('expected inlineScript')
  return d.body
}

describe('highlightPlugin option injection safety', () => {
  it('drops a malicious version and falls back to the pinned default', () => {
    const body = bodyOf({ version: '1; alert(1)' })
    expect(body).not.toContain('alert(1)')
    expect(body).toContain('highlight.js@11.11.1/')
  })

  it('drops a malicious theme and falls back to the auto sentinel', () => {
    const body = bodyOf({ theme: "a'b" })
    expect(body).not.toContain("a'b")
    expect(body).toContain('var configured = "auto"')
  })

  it('reflects valid options into the body', () => {
    const body = bodyOf({ version: '11.4.1', theme: 'github-dark' })
    expect(body).toContain('highlight.js@11.4.1/')
    // The theme name is resolved at runtime from `configured`, so an explicit
    // theme is embedded as the sentinel rather than a baked CSS filename.
    expect(body).toContain('var configured = "github-dark"')
    expect(body).toContain('/styles/')
  })

  it('an explicit theme is embedded as configured so the auto branch is bypassed', () => {
    const body = bodyOf({ theme: 'monokai' })
    // The runtime guard `configured === 'auto'` is now false, so the stylesheet
    // is pinned to the explicit theme regardless of the site scheme.
    expect(body).toContain('var configured = "monokai"')
  })
})
