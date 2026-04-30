import { describe, it, expect } from 'vitest'
import { detectContentEvents } from './events.js'

describe('detectContentEvents', () => {
  it('INSERT of a draft → content.created only', () => {
    expect(
      detectContentEvents({ eventName: 'INSERT', newStatus: 'draft' })
    ).toEqual(['content.created'])
  })

  it('INSERT of a published post → content.created + content.published', () => {
    expect(
      detectContentEvents({ eventName: 'INSERT', newStatus: 'published' })
    ).toEqual(['content.created', 'content.published'])
  })

  it('MODIFY draft → published emits content.updated + content.published', () => {
    expect(
      detectContentEvents({
        eventName: 'MODIFY',
        oldStatus: 'draft',
        newStatus: 'published',
      })
    ).toEqual(['content.updated', 'content.published'])
  })

  it('MODIFY published → draft emits content.updated + content.unpublished', () => {
    expect(
      detectContentEvents({
        eventName: 'MODIFY',
        oldStatus: 'published',
        newStatus: 'draft',
      })
    ).toEqual(['content.updated', 'content.unpublished'])
  })

  it('MODIFY draft → draft (edit on draft) emits content.updated only', () => {
    expect(
      detectContentEvents({
        eventName: 'MODIFY',
        oldStatus: 'draft',
        newStatus: 'draft',
      })
    ).toEqual(['content.updated'])
  })

  it('MODIFY published → published (edit while published) emits content.updated only', () => {
    expect(
      detectContentEvents({
        eventName: 'MODIFY',
        oldStatus: 'published',
        newStatus: 'published',
      })
    ).toEqual(['content.updated'])
  })

  it('REMOVE of a published post → content.unpublished + content.deleted', () => {
    expect(
      detectContentEvents({ eventName: 'REMOVE', oldStatus: 'published' })
    ).toEqual(['content.unpublished', 'content.deleted'])
  })

  it('REMOVE of a draft → content.deleted only', () => {
    expect(
      detectContentEvents({ eventName: 'REMOVE', oldStatus: 'draft' })
    ).toEqual(['content.deleted'])
  })

  it('unknown eventName → empty list', () => {
    expect(detectContentEvents({ eventName: 'WAT' })).toEqual([])
    expect(detectContentEvents({ eventName: undefined })).toEqual([])
  })
})
