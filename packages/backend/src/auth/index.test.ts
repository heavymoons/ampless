import { describe, it, expect } from 'vitest'
import { amplessAuthConfig } from './index.js'

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
