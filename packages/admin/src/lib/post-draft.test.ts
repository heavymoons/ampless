/**
 * Unit tests for the post-draft reconciliation decision. These are pure
 * functions (no DOM / localStorage), so they cover the recover / stale /
 * discard branching without needing jsdom.
 */

import { describe, it, expect } from 'vitest'
import {
  reconcileDraft,
  draftDiffersFromLoaded,
  type PostDraft,
  type LoadedPostState,
} from './post-draft.js'

const LOADED: LoadedPostState = {
  title: 'Hello',
  slug: 'hello',
  excerpt: 'An intro',
  format: 'tiptap',
  body: { type: 'doc', content: [{ type: 'paragraph' }] },
  status: 'draft',
  tags: 'a, b',
  publishedAtInput: '',
  noLayout: false,
  postClasses: ['wide'],
  rawPostClasses: ['wide'],
  updatedAt: '2026-06-05T10:00:00.000Z',
}

function draftFrom(over: Partial<PostDraft> = {}): PostDraft {
  return {
    title: LOADED.title,
    slug: LOADED.slug,
    excerpt: LOADED.excerpt,
    format: LOADED.format,
    body: LOADED.body,
    status: LOADED.status,
    tags: LOADED.tags,
    publishedAtInput: LOADED.publishedAtInput,
    noLayout: LOADED.noLayout,
    postClasses: LOADED.postClasses,
    baseUpdatedAt: LOADED.updatedAt,
    savedAt: 1_700_000_000_000,
    ...over,
  }
}

describe('reconcileDraft', () => {
  it('recovers when base matches and content differs', () => {
    const draft = draftFrom({ title: 'Hello (edited)' })
    expect(reconcileDraft(draft, LOADED)).toBe('recover')
  })

  it('discards when base matches and content is identical', () => {
    const draft = draftFrom()
    expect(reconcileDraft(draft, LOADED)).toBe('discard')
  })

  it('flags stale when the server base version moved under the draft', () => {
    const draft = draftFrom({
      title: 'Hello (edited)',
      baseUpdatedAt: '2026-06-05T09:00:00.000Z', // older than loaded
    })
    expect(reconcileDraft(draft, LOADED)).toBe('stale')
  })

  it('discards (not stale) when content equals current even if base differs', () => {
    // Content-equality is checked before the base-version test: a draft
    // that already matches the loaded content has nothing to restore, so
    // it is dropped silently rather than warning about a moved base.
    const draft = draftFrom({ baseUpdatedAt: '2026-06-04T00:00:00.000Z' })
    expect(reconcileDraft(draft, LOADED)).toBe('discard')
  })

  it('flags stale when content differs AND the base version moved', () => {
    const draft = draftFrom({
      title: 'Hello (edited)',
      baseUpdatedAt: '2026-06-04T00:00:00.000Z',
    })
    expect(reconcileDraft(draft, LOADED)).toBe('stale')
  })

  it('treats both-null base as the new-post case (not stale)', () => {
    const newLoaded: LoadedPostState = { ...LOADED, updatedAt: null }
    const recover = draftFrom({ baseUpdatedAt: null, title: 'Typed something' })
    const same = draftFrom({ baseUpdatedAt: null })
    expect(reconcileDraft(recover, newLoaded)).toBe('recover')
    expect(reconcileDraft(same, newLoaded)).toBe('discard')
  })
})

describe('draftDiffersFromLoaded', () => {
  it('detects a tiptap body change via structural compare', () => {
    const draft = draftFrom({
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
    })
    expect(draftDiffersFromLoaded(draft, LOADED)).toBe(true)
  })

  it('returns false for a structurally-equal (but not same-reference) body', () => {
    const draft = draftFrom({
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
    })
    expect(draftDiffersFromLoaded(draft, LOADED)).toBe(false)
  })

  it('detects a string body (markdown / html) change', () => {
    const md: LoadedPostState = { ...LOADED, format: 'markdown', body: '# Hi' }
    const draft = draftFrom({ format: 'markdown', body: '# Hi there' })
    expect(draftDiffersFromLoaded(draft, md)).toBe(true)
  })

  it('detects a tags-input change', () => {
    expect(draftDiffersFromLoaded(draftFrom({ tags: 'a, b, c' }), LOADED)).toBe(true)
  })

  it('detects a post classes change, including order', () => {
    expect(draftDiffersFromLoaded(draftFrom({ postClasses: [] }), LOADED)).toBe(true)
    expect(draftDiffersFromLoaded(draftFrom({ postClasses: ['wide', 'serif'] }), LOADED)).toBe(true)
    expect(
      draftDiffersFromLoaded(draftFrom({ postClasses: ['serif', 'wide'] }), {
        ...LOADED,
        postClasses: ['wide', 'serif'],
        rawPostClasses: ['wide', 'serif'],
      }),
    ).toBe(true)
    expect(draftDiffersFromLoaded(draftFrom({ postClasses: ['wide'] }), LOADED)).toBe(false)
  })

  it('treats a draft without postClasses (written before the field existed) as not differing on it', () => {
    const legacy = draftFrom()
    delete legacy.postClasses
    expect(draftDiffersFromLoaded(legacy, LOADED)).toBe(false)
  })

  it('compares a draft list against the raw stored value, not the normalized one', () => {
    // Saving the draft would replace a malformed stored value, so it differs.
    const malformed: LoadedPostState = { ...LOADED, postClasses: ['wide'], rawPostClasses: ['wide', 'wide', 'Bad'] }
    expect(draftDiffersFromLoaded(draftFrom({ postClasses: ['wide'] }), malformed)).toBe(true)
    const objectValue: LoadedPostState = { ...LOADED, postClasses: [], rawPostClasses: { plugin: 'x' } }
    expect(draftDiffersFromLoaded(draftFrom({ postClasses: [] }), objectValue)).toBe(true)
    // ...while an untouched draft (no field) keeps it and does not differ.
    const untouched = draftFrom()
    delete untouched.postClasses
    expect(draftDiffersFromLoaded(untouched, malformed)).toBe(false)
    // An absent stored value equals an empty selection.
    const none: LoadedPostState = { ...LOADED, postClasses: [], rawPostClasses: undefined }
    expect(draftDiffersFromLoaded(draftFrom({ postClasses: [] }), none)).toBe(false)
  })
})
