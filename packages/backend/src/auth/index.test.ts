import { describe, it, expect, vi } from 'vitest'
import { amplessAuthConfig, resolveWebAuthn } from './index.js'

// `amplessAuthConfig` returns a plain props object (the actual
// `defineAuth` call lives in the user's `amplify/auth/resource.ts`),
// so we can assert on the returned `loginWith` shape directly without
// pulling CDK into the test.

describe('amplessAuthConfig', () => {
  it('enables passkeys (webAuthn) by default', () => {
    const config = amplessAuthConfig()
    expect(config.loginWith).toMatchObject({ email: true, webAuthn: true })
  })

  it('omits the webAuthn key when webAuthn is false', () => {
    const config = amplessAuthConfig({ webAuthn: false })
    expect(config.loginWith).toEqual({ email: true })
    expect('webAuthn' in (config.loginWith ?? {})).toBe(false)
  })

  it('passes a custom relyingPartyId through unchanged', () => {
    const config = amplessAuthConfig({
      webAuthn: { relyingPartyId: 'admin.example.com', userVerification: 'required' },
    })
    expect(config.loginWith).toMatchObject({
      email: true,
      webAuthn: { relyingPartyId: 'admin.example.com', userVerification: 'required' },
    })
  })

  it('keeps the existing groups and trigger behaviour', () => {
    expect(amplessAuthConfig().groups).toEqual([
      'ampless-admin',
      'ampless-editor',
      'ampless-reader',
    ])
    // No post-confirmation passed → triggers stay undefined.
    expect(amplessAuthConfig().triggers).toBeUndefined()
    // A post-confirmation handler is forwarded.
    const fakeHandler = { __marker: 'post-confirmation' }
    expect(amplessAuthConfig({ postConfirmation: fakeHandler }).triggers).toMatchObject({
      postConfirmation: fakeHandler,
    })
  })
})

// ---------------------------------------------------------------------------
// resolveWebAuthn
// ---------------------------------------------------------------------------

describe('resolveWebAuthn', () => {
  it('returns the override verbatim when override is provided', () => {
    expect(resolveWebAuthn({ override: { relyingPartyId: 'admin.example.com' }, siteUrl: 'https://example.com', isPipeline: true })).toEqual({ relyingPartyId: 'admin.example.com' })
  })

  it('returns false when override is false (disabling passkeys)', () => {
    expect(resolveWebAuthn({ override: false, siteUrl: 'https://example.com', isPipeline: true })).toBe(false)
  })

  it('returns true for sandbox / non-pipeline builds (RP auto-resolved by Amplify)', () => {
    expect(resolveWebAuthn({ siteUrl: 'https://example.com', isPipeline: false })).toBe(true)
    expect(resolveWebAuthn({ siteUrl: 'http://localhost:3000', isPipeline: false })).toBe(true)
  })

  it('derives relyingPartyId from siteUrl hostname in pipeline builds', () => {
    expect(resolveWebAuthn({ siteUrl: 'https://example.com', isPipeline: true })).toEqual({ relyingPartyId: 'example.com' })
    expect(resolveWebAuthn({ siteUrl: 'https://example.com/blog', isPipeline: true })).toEqual({ relyingPartyId: 'example.com' })
  })

  it('derives localhost from http://localhost:3000 if somehow passed with isPipeline:true', () => {
    expect(resolveWebAuthn({ siteUrl: 'http://localhost:3000', isPipeline: true })).toEqual({ relyingPartyId: 'localhost' })
  })

  it('falls back to true and warns when siteUrl is invalid in a pipeline build', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(resolveWebAuthn({ siteUrl: 'not-a-url', isPipeline: true })).toBe(true)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ampless] invalid site.url'),
        'not-a-url'
      )
    } finally {
      warnSpy.mockRestore()
    }
  })
})
