import { describe, it, expect } from 'vitest'
import { tools } from './index.js'
import { publicTools } from '../public/index.js'

// The MCP annotation logic in `@ampless/mcp-server/jsonrpc` only emits a
// `destructiveHint` when a tool sets `destructive` explicitly; an
// unclassified tool falls back to the spec default (true, the safe
// side) but silently loses its `readOnlyHint`. These tests pin every
// registered tool to an explicit classification so a newly-added tool
// can't slip through unclassified.

const EXPECTED_ADMIN: Record<string, { readOnly: boolean; destructive: boolean }> = {
  // Pure read.
  list_posts: { readOnly: true, destructive: false },
  get_post: { readOnly: true, destructive: false },
  get_schema: { readOnly: true, destructive: false },
  list_media: { readOnly: true, destructive: false },
  search_media: { readOnly: true, destructive: false },
  // Pure additive write.
  create_post: { readOnly: false, destructive: false },
  upload_media: { readOnly: false, destructive: false },
  // Overwriting write.
  update_post: { readOnly: false, destructive: true },
  upload_static_file: { readOnly: false, destructive: true },
  commit_static_post: { readOnly: false, destructive: true },
  // Destructive.
  delete_post: { readOnly: false, destructive: true },
  delete_media: { readOnly: false, destructive: true },
  upload_static_bundle: { readOnly: false, destructive: true },
  delete_static_file: { readOnly: false, destructive: true },
}

describe('tool registry classification', () => {
  it('the admin registry has exactly the 14 expected tools', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(EXPECTED_ADMIN).sort())
  })

  it('every admin tool is classified with the expected readOnly / destructive flags', () => {
    for (const tool of tools) {
      const expected = EXPECTED_ADMIN[tool.name]
      expect(expected, `unexpected/unclassified admin tool: ${tool.name}`).toBeDefined()
      expect({ readOnly: tool.readOnly, destructive: tool.destructive }).toEqual(expected)
    }
  })

  it('every public tool is classified as read-only, non-destructive', () => {
    expect(publicTools.map((t) => t.name).sort()).toEqual(
      ['get_post', 'list_posts', 'list_tags', 'search_posts'].sort()
    )
    for (const tool of publicTools) {
      expect({ readOnly: tool.readOnly, destructive: tool.destructive }).toEqual({
        readOnly: true,
        destructive: false,
      })
    }
  })

  it('all 18 tools (14 admin + 4 public) carry explicit boolean readOnly + destructive', () => {
    const all = [...tools, ...publicTools]
    expect(all.length).toBe(18)
    for (const tool of all) {
      expect(typeof tool.readOnly, `${tool.name}.readOnly`).toBe('boolean')
      expect(typeof tool.destructive, `${tool.name}.destructive`).toBe('boolean')
    }
  })
})
