import { describe, it, expect } from 'vitest'
import { Node } from '@tiptap/core'
import {
  installAdminEditorExtensions,
  getAdminEditorExtensions,
} from './admin-editor-extensions.js'

// NOTE on the real-tiptap-Node usage below: this file is typechecked by
// `pnpm lint` (tsc --noEmit over src/). Passing `Node.create(...)` instances
// to `installAdminEditorExtensions` WITHOUT casts is the regression pin for
// the Amplify Hosting build failure where `TiptapExtensionLike` carried an
// index signature — TypeScript class instances don't get implicit index
// signatures, so every codegen'd `_editor-bootstrap.tsx` in user sites
// failed Next.js typecheck with "Index signature for type 'string' is
// missing in type 'Node<any, any>'". If someone re-adds the index
// signature, this file stops compiling.

const FakeEmbedNode = Node.create({
  name: 'fakeEmbedA',
  group: 'block',
  atom: true,
})

const OtherEmbedNode = Node.create({
  name: 'fakeEmbedB',
  group: 'block',
  atom: true,
})

describe('installAdminEditorExtensions', () => {
  it('accepts real tiptap Node class instances without casts and registers them', () => {
    installAdminEditorExtensions([FakeEmbedNode, OtherEmbedNode])

    const installed = getAdminEditorExtensions()
    expect(installed).toHaveLength(2)
    expect(installed[0]?.name).toBe('fakeEmbedA')
    expect(installed[1]?.name).toBe('fakeEmbedB')
  })

  it('is idempotent — a second install call is a no-op', () => {
    // First install happened in the previous test (module-level registry).
    installAdminEditorExtensions([FakeEmbedNode])
    expect(getAdminEditorExtensions()).toHaveLength(2)
  })
})
