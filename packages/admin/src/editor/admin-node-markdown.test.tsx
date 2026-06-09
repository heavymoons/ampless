import { describe, it, expect } from 'vitest'
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
    mod.installAdminTiptapNodeMarkdown([{ myNode: adapter }])
    const result = mod.getAdminTiptapNodeMarkdown()
    expect(result['myNode']).toBe(adapter)
  })

  it('idempotent: second call is a no-op (HMR / double-mount safe)', async () => {
    const mod = await freshModule()
    const first = () => 'first'
    const second = () => 'second'
    mod.installAdminTiptapNodeMarkdown([{ myNode: first }])
    // Second call should be ignored because `installed` is already true
    mod.installAdminTiptapNodeMarkdown([{ myNode: second }])
    expect(mod.getAdminTiptapNodeMarkdown()['myNode']).toBe(first)
  })

  it('merges adapters across multiple maps in a single call (= multi-plugin bootstrap)', async () => {
    const mod = await freshModule()
    const a = () => 'a'
    const b = () => 'b'
    // Each plugin's map is a separate array entry
    mod.installAdminTiptapNodeMarkdown([{ nodeA: a }, { nodeB: b }])
    const map = mod.getAdminTiptapNodeMarkdown()
    expect(map['nodeA']).toBe(a)
    expect(map['nodeB']).toBe(b)
  })

  it('throws on cross-map nodeType collision with different adapter functions', async () => {
    // This is the bug reviewer caught: pre-merging `{ ...a, ...b }` lost
    // collisions silently because JS object spread dedupes keys. Passing
    // separate maps in an array lets the install walk them independently
    // and detect when two plugins claim the same nodeType.
    const mod = await freshModule()
    const yt = () => 'youtube'
    const rogue = () => 'rogue'
    expect(() =>
      mod.installAdminTiptapNodeMarkdown([
        { amplessYoutube: yt },
        // A misbehaving second plugin claims the same nodeType
        { amplessYoutube: rogue },
      ]),
    ).toThrow(/amplessYoutube/)
  })

  it('allows the SAME adapter function to appear under the same nodeType in multiple maps', async () => {
    // Same function reference appearing twice (e.g. idempotent re-runs
    // of the same plugin's map) must not throw — only DIFFERENT functions
    // on the same nodeType should.
    const mod = await freshModule()
    const shared = () => 'shared'
    expect(() =>
      mod.installAdminTiptapNodeMarkdown([
        { sharedNode: shared },
        { sharedNode: shared },
      ]),
    ).not.toThrow()
    expect(mod.getAdminTiptapNodeMarkdown()['sharedNode']).toBe(shared)
  })

  it('getter returns an empty object initially (before any install)', async () => {
    const mod = await freshModule()
    const result = mod.getAdminTiptapNodeMarkdown()
    expect(Object.keys(result)).toHaveLength(0)
  })
})
