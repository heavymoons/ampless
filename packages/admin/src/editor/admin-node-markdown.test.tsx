import { describe, it, expect, beforeEach } from 'vitest'
import { vi } from 'vitest'

// Reset module state between tests by re-importing a fresh module instance.
// Vitest's module isolation lets us do this with vi.resetModules() +
// dynamic import so each test sees an empty adapters store.
async function freshModule() {
  vi.resetModules()
  return import('./admin-node-markdown.js')
}

describe('installAdminTiptapNodeMarkdown', () => {
  it('install + get round-trip: adapters are stored and returned', async () => {
    const mod = await freshModule()
    const adapter = (node: any) => `url:${node.attrs?.id}`
    mod.installAdminTiptapNodeMarkdown({ myNode: adapter })
    const result = mod.getAdminTiptapNodeMarkdown()
    expect(result['myNode']).toBe(adapter)
  })

  it('idempotent: second call is a no-op (HMR / double-mount safe)', async () => {
    const mod = await freshModule()
    const first = () => 'first'
    const second = () => 'second'
    mod.installAdminTiptapNodeMarkdown({ myNode: first })
    // Second call should be ignored because `installed` is already true
    mod.installAdminTiptapNodeMarkdown({ myNode: second })
    expect(mod.getAdminTiptapNodeMarkdown()['myNode']).toBe(first)
  })

  it('registers multiple nodeType adapters in a single call', async () => {
    const mod = await freshModule()
    const a = () => 'a'
    const b = () => 'b'
    mod.installAdminTiptapNodeMarkdown({ nodeA: a, nodeB: b })
    const map = mod.getAdminTiptapNodeMarkdown()
    expect(map['nodeA']).toBe(a)
    expect(map['nodeB']).toBe(b)
  })

  it('getter returns an empty object initially (before any install)', async () => {
    const mod = await freshModule()
    const result = mod.getAdminTiptapNodeMarkdown()
    expect(Object.keys(result)).toHaveLength(0)
  })
})
