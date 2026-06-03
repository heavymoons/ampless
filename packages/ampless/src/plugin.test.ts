import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  definePlugin,
  type PluginEventHandler,
  type PluginHookResult,
  type PluginSecretField,
} from './plugin.js'

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// PluginSecretField type-level tests
// ---------------------------------------------------------------------------
//
// TypeScript doesn't ship an assertion helper, but we can verify the
// absence of `default` at the type level by using a type assertion. If
// `default` were present on the type, the lines below would produce a
// TypeScript compile error. We also verify the allowed fields exist.

// This block is compile-time only — it never executes.
;(() => {
  const _textField: PluginSecretField = {
    type: 'text',
    key: 'signingSecret',
    label: 'Signing Secret',
    // @ts-expect-error — `default` must NOT be present on PluginSecretField
    default: 'foo',
  }
  void _textField

  const _textareaField: PluginSecretField = {
    type: 'textarea',
    key: 'apiKey',
    label: 'API Key',
    // @ts-expect-error — `default` must NOT be present on PluginSecretField
    default: 'bar',
  }
  void _textareaField

  // Valid secret field shapes (no default) — should NOT produce TS errors:
  const _validText: PluginSecretField = {
    type: 'text',
    key: 'signingSecret',
    label: 'Signing Secret',
    maxLength: 256,
  }
  void _validText

  const _validTextarea: PluginSecretField = {
    type: 'textarea',
    key: 'privateKey',
    label: 'Private Key',
    rows: 4,
  }
  void _validTextarea
})

// ---------------------------------------------------------------------------
// PluginEventHandler / PluginHookResult type-level tests
// ---------------------------------------------------------------------------
//
// Verified by `tsc --noEmit` (= `pnpm -F ampless lint`), NOT by vitest —
// vitest only transpiles and does not surface `@ts-expect-error` failures.
// If a regression breaks the private-marker reservation, `pnpm lint`
// catches it; `pnpm test` would silently pass.

// Compile-time only block — never executed.
;(() => {
  // 1. Existing `Promise<void>` hooks remain assignable (regression).
  const _voidHook: PluginEventHandler<'content.published'> = async () => {}
  void _voidHook

  // 2. Explicit `Promise<PluginHookResult>` hooks are accepted (the
  //    reservation surface). Plugin authors do not need to set the
  //    private marker — an empty cast to PluginHookResult suffices.
  const _structuredHook: PluginEventHandler<'content.published'> = async () =>
    ({}) as PluginHookResult
  void _structuredHook

  // 3. Unrelated promise types are REJECTED at compile time by the
  //    `__amplessPluginHookResult` private marker. If this stops being
  //    a TS error, the marker is broken and `pnpm lint` will report
  //    `@ts-expect-error` having no effect.
  const _wrongHook: PluginEventHandler<'content.published'> = async () =>
    // @ts-expect-error — string is not assignable to void | PluginHookResult
    'oops'
  void _wrongHook

  // 4. Numbers are also rejected (same marker, second variant).
  const _wrongNumberHook: PluginEventHandler<'content.published'> = async () =>
    // @ts-expect-error — number is not assignable to void | PluginHookResult
    42
  void _wrongNumberHook
})()

// ---------------------------------------------------------------------------
// definePlugin — manifest validation
// ---------------------------------------------------------------------------

describe('definePlugin — settings.secret with untrusted trust_level', () => {
  it('throws when settings.secret is declared with trust_level "untrusted"', () => {
    expect(() =>
      definePlugin({
        name: 'my-plugin',
        apiVersion: 1,
        trust_level: 'untrusted',
        capabilities: ['secretSettings'],
        settings: {
          secret: [
            {
              type: 'text',
              key: 'apiKey',
              label: 'API Key',
            },
          ],
        },
      })
    ).toThrow(/trust_level.*trusted/)
  })

  it('throws when settings.secret is declared with trust_level "privileged"', () => {
    expect(() =>
      definePlugin({
        name: 'my-plugin',
        apiVersion: 1,
        trust_level: 'privileged',
        capabilities: ['secretSettings'],
        settings: {
          secret: [
            {
              type: 'text',
              key: 'apiKey',
              label: 'API Key',
            },
          ],
        },
      })
    ).toThrow(/trust_level.*trusted/)
  })

  it('does NOT throw when settings.secret is declared with trust_level "trusted"', () => {
    expect(() =>
      definePlugin({
        name: 'my-plugin',
        apiVersion: 1,
        trust_level: 'trusted',
        capabilities: ['secretSettings'],
        settings: {
          secret: [
            {
              type: 'text',
              key: 'apiKey',
              label: 'API Key',
            },
          ],
        },
      })
    ).not.toThrow()
  })

  it('does NOT throw when settings.secret is empty array (no-op, trusted)', () => {
    expect(() =>
      definePlugin({
        name: 'my-plugin',
        apiVersion: 1,
        trust_level: 'untrusted',
        settings: {
          secret: [],
        },
      })
    ).not.toThrow()
  })

  it('does NOT throw when settings has only public fields (no secret)', () => {
    expect(() =>
      definePlugin({
        name: 'my-plugin',
        apiVersion: 1,
        trust_level: 'untrusted',
        settings: {
          public: [
            {
              type: 'text',
              key: 'measurementId',
              label: 'Measurement ID',
            },
          ],
        },
      })
    ).not.toThrow()
  })

  it('throws with message mentioning the plugin name', () => {
    expect(() =>
      definePlugin({
        name: 'webhook',
        apiVersion: 1,
        trust_level: 'untrusted',
        settings: {
          secret: [{ type: 'text', key: 'signingSecret', label: 'Signing Secret' }],
        },
      })
    ).toThrow(/plugin.*webhook/i)
  })
})

describe('definePlugin — settings.secret capability mismatch warning', () => {
  it('warns when settings.secret is declared but "secretSettings" is not in capabilities', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    definePlugin({
      name: 'my-plugin',
      apiVersion: 1,
      trust_level: 'trusted',
      // capabilities declared but secretSettings is missing
      capabilities: ['eventHooks'],
      settings: {
        secret: [{ type: 'text', key: 'apiKey', label: 'API Key' }],
      },
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('secretSettings'))
  })

  it('does NOT warn when "secretSettings" is in capabilities', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    definePlugin({
      name: 'my-plugin',
      apiVersion: 1,
      trust_level: 'trusted',
      capabilities: ['eventHooks', 'secretSettings'],
      settings: {
        secret: [{ type: 'text', key: 'apiKey', label: 'API Key' }],
      },
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('does NOT warn when capabilities is undefined (legacy plugin)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    definePlugin({
      name: 'my-plugin',
      apiVersion: 1,
      trust_level: 'trusted',
      // no capabilities field at all
      settings: {
        secret: [{ type: 'text', key: 'apiKey', label: 'API Key' }],
      },
    })
    expect(warn).not.toHaveBeenCalled()
  })
})
