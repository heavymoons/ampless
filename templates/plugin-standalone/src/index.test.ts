import { describe, it, expect } from 'vitest'
import {{nameCamelCase}}Plugin from './index.js'

describe('{{nameCamelCase}}Plugin', () => {
  it('returns a plugin with the declared name + apiVersion', () => {
    const plugin = {{nameCamelCase}}Plugin()
    expect(plugin.name).toBe('{{nameKebab}}')
    expect(plugin.apiVersion).toBe(1)
    expect(plugin.trust_level).toBe('{{trustLevel}}')
  })

  it('honors an explicit instanceId', () => {
    const plugin = {{nameCamelCase}}Plugin({ instanceId: 'custom-instance' })
    expect(plugin.instanceId).toBe('custom-instance')
  })
})
