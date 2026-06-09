import { describe, it, expect } from 'vitest'
import { vi } from 'vitest'

// Reset module state between tests by re-importing a fresh module instance.
// Vitest's module isolation lets us do this with vi.resetModules() +
// dynamic import so each test sees an empty adapters store.
async function freshModule() {
  vi.resetModules()
  return import('./admin-node-html.js')
}

describe('installAdminTiptapNodeHtml', () => {
  it('install + get round-trip: adapters are stored and returned', async () => {
    const mod = await freshModule()
    const adapter = (node: any) => `<div data-id="${node.attrs?.id}"></div>`
    mod.installAdminTiptapNodeHtml([{ myNode: adapter }])
    const result = mod.getAdminTiptapNodeHtml()
    expect(result['myNode']).toBe(adapter)
  })

  it('idempotent: second call is a no-op (HMR / double-mount safe)', async () => {
    const mod = await freshModule()
    const first = () => '<div class="first"></div>'
    const second = () => '<div class="second"></div>'
    mod.installAdminTiptapNodeHtml([{ myNode: first }])
    // Second call should be ignored because `installed` is already true
    mod.installAdminTiptapNodeHtml([{ myNode: second }])
    expect(mod.getAdminTiptapNodeHtml()['myNode']).toBe(first)
  })

  it('merges adapters across multiple maps in a single call (= multi-plugin bootstrap)', async () => {
    const mod = await freshModule()
    const a = () => '<div class="a"></div>'
    const b = () => '<div class="b"></div>'
    // Each plugin's map is a separate array entry
    mod.installAdminTiptapNodeHtml([{ nodeA: a }, { nodeB: b }])
    const map = mod.getAdminTiptapNodeHtml()
    expect(map['nodeA']).toBe(a)
    expect(map['nodeB']).toBe(b)
  })

  it('throws on cross-map nodeType collision with different adapter functions', async () => {
    // This is the bug reviewer caught: pre-merging `{ ...a, ...b }` lost
    // collisions silently because JS object spread dedupes keys. Passing
    // separate maps in an array lets the install walk them independently
    // and detect when two plugins claim the same nodeType.
    const mod = await freshModule()
    const yt = () => '<div data-ampless-youtube></div>'
    const rogue = () => '<div data-rogue></div>'
    expect(() =>
      mod.installAdminTiptapNodeHtml([
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
    const shared = () => '<div class="shared"></div>'
    expect(() =>
      mod.installAdminTiptapNodeHtml([
        { sharedNode: shared },
        { sharedNode: shared },
      ]),
    ).not.toThrow()
    expect(mod.getAdminTiptapNodeHtml()['sharedNode']).toBe(shared)
  })

  it('getter returns an empty object initially (before any install)', async () => {
    const mod = await freshModule()
    const result = mod.getAdminTiptapNodeHtml()
    expect(Object.keys(result)).toHaveLength(0)
  })
})
