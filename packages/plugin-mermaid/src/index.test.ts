import { describe, it, expect } from 'vitest'
import mermaidPlugin from './index.js'

describe('mermaidPlugin factory shape', () => {
  const p = mermaidPlugin()

  it('exposes the expected manifest fields', () => {
    expect(p.name).toBe('mermaid')
    expect(p.apiVersion).toBe(1)
    expect(p.trust_level).toBe('untrusted')
    expect(p.capabilities).toContain('publicHead')
    // Required so the runtime's static-manifest cross-check runs.
    expect(p.packageName).toBe('@ampless/plugin-mermaid')
  })
})

describe('mermaidPlugin publicHead', () => {
  const descriptors = mermaidPlugin().publicHead!({
    site: {} as never,
    setting: () => undefined,
  })

  it('returns exactly one inlineScript descriptor with the stable id', () => {
    expect(descriptors).toHaveLength(1)
    const d = descriptors[0]!
    expect(d.type).toBe('inlineScript')
    if (d.type !== 'inlineScript') throw new Error('expected inlineScript')
    expect(d.id).toBe('ampless-mermaid')
  })

  it('body contains the required markers', () => {
    const d = descriptors[0]!
    if (d.type !== 'inlineScript') throw new Error('expected inlineScript')
    const body = d.body
    expect(body).toContain('language-mermaid')
    expect(body).toContain('cdn.jsdelivr.net/npm/mermaid@')
    expect(body).toContain('mermaid.esm.min.mjs')
    expect(body).toContain('securityLevel')
    expect(body).toContain('strict')
    expect(body).toContain('MutationObserver')
  })
})

function bodyOf(opts: Parameters<typeof mermaidPlugin>[0]): string {
  const d = mermaidPlugin(opts).publicHead!({
    site: {} as never,
    setting: () => undefined,
  })[0]!
  if (d.type !== 'inlineScript') throw new Error('expected inlineScript')
  return d.body
}

describe('mermaidPlugin option injection safety', () => {
  it('drops a malicious version and falls back to the pinned default', () => {
    const body = bodyOf({ version: '1; alert(1)' })
    expect(body).not.toContain('alert(1)')
    expect(body).toContain('mermaid@11.15.0/')
  })

  it('drops an out-of-allowlist securityLevel and falls back to strict', () => {
    const body = bodyOf({ securityLevel: 'evil' as never })
    expect(body).not.toContain('evil')
    expect(body).toContain('"strict"')
  })

  it('drops an out-of-allowlist theme and falls back to default', () => {
    const body = bodyOf({ theme: "a'b" as never })
    expect(body).not.toContain("a'b")
    expect(body).toContain('"default"')
  })

  it('reflects valid options into the body', () => {
    const body = bodyOf({
      version: '11.4.1',
      theme: 'forest',
      securityLevel: 'sandbox',
    })
    expect(body).toContain('mermaid@11.4.1/')
    expect(body).toContain('"forest"')
    expect(body).toContain('"sandbox"')
  })
})
