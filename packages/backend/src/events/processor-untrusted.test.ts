import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AmplessPlugin, Config } from 'ampless'

// Mock `ampless` so this test file runs without the package being built.
vi.mock('ampless', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>().catch(() => ({}))
  return {
    ...original,
  }
})

import { createProcessorUntrustedHandler } from './processor-untrusted.js'

const site: Config['site'] = { name: 'Test', url: 'https://example.com' }

function event(
  type = 'content.published'
): Parameters<ReturnType<typeof createProcessorUntrustedHandler>>[0] {
  return {
    Records: [
      {
        body: JSON.stringify({ type, payload: {} }),
      },
    ],
  } as Parameters<ReturnType<typeof createProcessorUntrustedHandler>>[0]
}

// ---------------------------------------------------------------------------
// privileged plugin hook visibility warning
// ---------------------------------------------------------------------------

describe('createProcessorUntrustedHandler — privileged plugin hook visibility', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('warns about privileged plugin hook and untrusted plugin hook still executes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let untrustedHookRan = false
    let privilegedHookRan = false

    const handler = createProcessorUntrustedHandler({
      site,
      plugins: [
        {
          name: 'my-untrusted-plugin',
          apiVersion: 1,
          trust_level: 'untrusted',
          hooks: {
            'content.published': async () => {
              untrustedHookRan = true
              await Promise.resolve()
            },
          },
        } as AmplessPlugin,
        {
          name: 'my-privileged-plugin',
          apiVersion: 1,
          trust_level: 'privileged',
          hooks: {
            'content.published': async () => {
              privilegedHookRan = true
            },
          },
        } as AmplessPlugin,
      ],
    })

    await handler(event(), {} as never, vi.fn() as never)

    // Privileged plugin gets a warning
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('my-privileged-plugin'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hook will not execute'))
    // Privileged plugin hook never ran
    expect(privilegedHookRan).toBe(false)
    // Untrusted plugin hook ran normally
    expect(untrustedHookRan).toBe(true)
  })

  it('does NOT bail out early and warns when only privileged plugins are configured (no untrusted)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let privilegedHookRan = false

    const handler = createProcessorUntrustedHandler({
      site,
      plugins: [
        {
          name: 'my-privileged-plugin',
          apiVersion: 1,
          trust_level: 'privileged',
          hooks: {
            'content.published': async () => {
              privilegedHookRan = true
            },
          },
        } as AmplessPlugin,
      ],
    })

    await handler(event(), {} as never, vi.fn() as never)

    // Warning must be emitted (the early-return guard was broadened)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('my-privileged-plugin'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hook will not execute'))
    // Hook never ran
    expect(privilegedHookRan).toBe(false)
  })

  it('does NOT warn when there are no privileged plugins (untrusted only)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let untrustedHookRan = false

    const handler = createProcessorUntrustedHandler({
      site,
      plugins: [
        {
          name: 'my-untrusted-plugin',
          apiVersion: 1,
          trust_level: 'untrusted',
          hooks: {
            'content.published': async () => {
              untrustedHookRan = true
              await Promise.resolve()
            },
          },
        } as AmplessPlugin,
      ],
    })

    await handler(event(), {} as never, vi.fn() as never)

    // Untrusted hook ran normally
    expect(untrustedHookRan).toBe(true)
    // No warning about privileged plugins
    const privilegedWarns = (warn.mock.calls as Array<[string]>).filter(([msg]) =>
      msg?.includes('privileged')
    )
    expect(privilegedWarns).toHaveLength(0)
  })
})
