import { describe, it, expect } from 'vitest'
import { signPayload } from './sign.js'

describe('signPayload', () => {
  it('produces a stable sha256= hex string for known input', () => {
    // Reference value from
    //   node -e "const {createHmac}=require('crypto');
    //            console.log(createHmac('sha256','key').update('hello').digest('hex'))"
    expect(signPayload('key', 'hello')).toBe(
      'sha256=9307b3b915efb5171ff14d8cb55fbcc798c6c0ef1456d66ded1a6aa723a58b7b'
    )
  })

  it('changes when the body changes', () => {
    expect(signPayload('s', 'a')).not.toBe(signPayload('s', 'b'))
  })

  it('changes when the secret changes', () => {
    expect(signPayload('a', 'body')).not.toBe(signPayload('b', 'body'))
  })

  it('handles empty body', () => {
    expect(signPayload('s', '')).toMatch(/^sha256=[0-9a-f]{64}$/)
  })
})
