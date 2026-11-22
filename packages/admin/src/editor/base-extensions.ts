'use client'

// Shared list of base tiptap extensions used by both <TiptapEditor> and
// the format-switch 2-hop (`generateJSON` in format-switch.ts).
//
// Keeping this as a single source of truth ensures that the `generateJSON`
// call in the markdown→html 2-hop uses the same base set as the live editor,
// so parseHTML rules for embed nodes (plugin-youtube, plugin-x-embed) are
// active during the parse step.
//
// Internal-only — do NOT re-export from packages/admin/src/editor.ts.
// Both consumers (TiptapEditor and format-switch.ts) are inside this package.

import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Underline } from '@tiptap/extension-underline'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlign } from '@tiptap/extension-text-align'
import { isValidCustomClassId, tableCustomClassName } from 'ampless'

const TABLE_CLASS_PREFIX = tableCustomClassName('')

/**
 * Read a theme custom class id back from a table's class list
 * (`tiptap-table tiptap-table--compact` → `compact`). Invalid ids are
 * ignored. Exported for tests.
 */
export function parseTableCustomClass(className: string | null | undefined): string | null {
  for (const cls of (className ?? '').split(/\s+/)) {
    if (!cls.startsWith(TABLE_CLASS_PREFIX)) continue
    const id = cls.slice(TABLE_CLASS_PREFIX.length)
    if (isValidCustomClassId(id)) return id
  }
  return null
}

// Extend the Table extension with a per-table `customClass` attribute: a
// theme-declared class id (ThemeManifest.customClasses, target 'table').
// Stored as `attrs.customClass` in the tiptap JSON, rendered as
// `tiptap-table--<id>` next to the base `tiptap-table` class (tiptap's
// mergeAttributes concatenates classes), and parsed back from that class so
// html → tiptap format switches and pasted tables keep it. Ids that the
// active theme does not declare are kept as long as they are valid; the
// table controls flag them instead of dropping them.
const AmplessTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      customClass: {
        default: null,
        parseHTML: (el) => parseTableCustomClass(el.getAttribute('class')),
        renderHTML: (attrs) => {
          const v = attrs.customClass
          return isValidCustomClassId(v) ? { class: tableCustomClassName(v) } : {}
        },
      },
    }
  },
})

// Extend the Image extension with a per-image `display` attribute
// ("inline" | "lightbox" | null). null means "fall back to cms.config".
const AmplessImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      display: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-display'),
        renderHTML: (attrs) => {
          const v = attrs.display as string | null
          return v ? { 'data-display': v } : {}
        },
      },
    }
  },
})

/**
 * Base tiptap extensions shared by <TiptapEditor> and the format-switch
 * 2-hop. Spread into the extensions array before the plugin-registered
 * extensions from `getAdminEditorExtensions()`.
 *
 * **Same order and configure() calls as in tiptap-editor.tsx** — any
 * change here must be reflected there (the editor import replaces its
 * inline definition with this export).
 */
export const BASE_TIPTAP_EXTENSIONS = [
  StarterKit,
  Link.configure({ openOnClick: false }),
  AmplessImage.configure({ inline: false, allowBase64: false }),
  AmplessTable.configure({ resizable: true, HTMLAttributes: { class: 'tiptap-table' } }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  Underline,
  Highlight.configure({ multicolor: false }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
] as const
