// @ampless/plugin-reading-time — reading-time badge plugin.
//
// Estimates the reading time of a post from its body text and injects a
// configurable label paragraph (`<p class="ampless-reading-time">`) before
// or after the post content via the `publicHtmlForPost` capability.
//
// Format handling:
//  - 'tiptap'   — body is the tiptap JSON tree; recursively walks for text nodes
//  - 'markdown' — body is a string; strips markdown syntax before word-counting
//  - 'html'     — body is a string; strips HTML tags before word-counting
//  - 'static'   — no readable body; returns [] (no badge rendered)
//
// Both English (space-separated words) and CJK characters (count ÷ 2) are
// accounted for so multilingual posts produce a reasonable estimate.
//
// Architecture: docs/architecture/08-plugin-architecture.md — publicHtmlForPost.

import { definePlugin, type AmplessPlugin, type PublicPostHtmlDescriptor } from 'ampless'
import type { Post, ContentFormat } from 'ampless'

// Re-export so package consumers can type-check against these interfaces.
export type { ContentFormat }

export interface ReadingTimeOptions {
  /** Average words per minute. Default 200. */
  wordsPerMinute?: number
  /**
   * Template string for the label. Supports `{minutes}` and `{words}`
   * placeholders. Default `'{minutes} min read'`.
   */
  labelTemplate?: string
  /**
   * Where to inject the badge relative to the post body.
   * Default `'beforeContent'`.
   */
  position?: 'beforeContent' | 'afterContent'
  /**
   * Optional namespace for this instance. Defaults to `'reading-time'`.
   * Set a distinct value if registering the plugin more than once.
   */
  instanceId?: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface TiptapNode {
  type?: string
  text?: string
  content?: unknown[]
}

/**
 * Recursively walk a tiptap document JSON tree and collect all `text` node
 * values into a single plain-text string. Returns an empty string when the
 * body is not a valid tiptap document.
 */
function extractTiptapText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as TiptapNode

  // Text leaf node — return its text directly.
  if (n.type === 'text' && typeof n.text === 'string') {
    return n.text
  }

  // Any other node type — recurse into children.
  if (Array.isArray(n.content)) {
    return n.content.map((child) => extractTiptapText(child)).join(' ')
  }

  return ''
}

/**
 * Extract plain text from a post body. Returns an empty string for
 * `format: 'static'` or unknown formats (safety — no badge for unreadable
 * content).
 */
export function extractPlainText(post: Post): string {
  switch (post.format) {
    case 'tiptap': {
      return extractTiptapText(post.body)
    }
    case 'markdown': {
      if (typeof post.body !== 'string') return ''
      return post.body
        // Remove fenced code blocks (``` ... ```)
        .replace(/```[\s\S]*?```/g, ' ')
        // Remove inline code (`...`)
        .replace(/`[^`]*`/g, ' ')
        // Remove headings # marker
        .replace(/^#{1,6}\s+/gm, '')
        // Remove images ![alt](url)
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        // Remove links [text](url) — keep text
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        // Remove bold/italic markers (* _ ~)
        .replace(/[*_~]{1,3}/g, '')
        // Remove HTML tags
        .replace(/<[^>]+>/g, ' ')
    }
    case 'html': {
      if (typeof post.body !== 'string') return ''
      return post.body.replace(/<[^>]+>/g, ' ')
    }
    case 'static': {
      // Static bundles have no readable body.
      return ''
    }
    default: {
      // Unknown format — return empty string for safety.
      return ''
    }
  }
}

/**
 * Count the "reading units" in a plain-text string.
 *
 * - English words: whitespace-separated tokens (standard WPM baseline).
 * - CJK characters (Han, Hiragana, Katakana): each 2 characters ≈ 1 reading
 *   unit (roughly half the per-minute rate vs. English), so we count them and
 *   divide by 2.
 *
 * For multilingual posts, both counts are summed to give a combined word
 * estimate that feeds into the WPM calculation.
 */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0

  // CJK characters: Han ideographs + Hiragana + Katakana.
  const cjkMatches = trimmed.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)
  const cjkChars = cjkMatches ? cjkMatches.length : 0

  // Remove CJK characters before counting English words to avoid counting
  // runs of CJK glyphs joined by no whitespace as "one word". Then match
  // only tokens that contain at least one letter or digit — pure
  // punctuation clusters like `。` or `…` from mixed-script posts (or
  // `---` / `***` from markdown stripped output) would otherwise count
  // as their own "words" and inflate the estimate. The internal
  // `[\p{L}\p{N}'-]` class keeps contractions (`don't`) and hyphenated
  // compounds (`state-of-the-art`) intact as a single word.
  const withoutCjk = trimmed.replace(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,
    ' '
  )
  const englishMatches = withoutCjk.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)
  const englishWords = englishMatches ? englishMatches.length : 0

  return englishWords + Math.ceil(cjkChars / 2)
}

/**
 * Coerce an unknown `wordsPerMinute` value (constructor option or stored
 * setting) to a usable number inside the admin field's `[50, 1000]`
 * range. Anything outside that — `0`, negative, `NaN`, `Infinity`, a
 * non-number, or a string that can't parse — falls back to `fallback`.
 *
 * The admin UI's `min: 50, max: 1000` validators already gate
 * hand-edited settings, but the constructor option is public API and
 * a stored value can in theory be hand-edited in DynamoDB. Without
 * this guard, `readingTimePlugin({ wordsPerMinute: 0 })` would emit
 * `data-minutes="Infinity"` and `'Infinity min read'`.
 */
export function normalizeWpm(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  if (n < 50 || n > 1000) return fallback
  return n
}

/**
 * Escape characters that have special meaning in HTML attribute values and
 * text content. Applied to the rendered label string after placeholder
 * substitution — prevents XSS when a `labelTemplate` or stored setting
 * contains angle brackets or quotes.
 *
 * Only the five characters with HTML significance are replaced; no external
 * library is needed for this narrow use case.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Factory for the reading-time badge plugin. Returns a plugin that injects
 * a `<p class="ampless-reading-time">` element before or after the post
 * body via the `publicHtmlForPost` capability. The badge is omitted when the
 * post has no readable content (e.g. `format: 'static'`, empty body).
 *
 * Usage in `cms.config.ts`:
 *
 * ```ts
 * import readingTimePlugin from '@ampless/plugin-reading-time'
 *
 * export default defineConfig({
 *   plugins: [readingTimePlugin()],
 * })
 * ```
 *
 * All options are also editable from `/admin/plugins → Reading time` without
 * a redeploy — the constructor values below are the initial defaults.
 */
export default function readingTimePlugin(
  options: ReadingTimeOptions = {}
): AmplessPlugin {
  const {
    wordsPerMinute: rawWpm = 200,
    labelTemplate: defaultTemplate = '{minutes} min read',
    position: defaultPosition = 'beforeContent',
    instanceId,
  } = options
  // Normalize the constructor default once. A site author passing
  // `wordsPerMinute: 0` (or NaN, Infinity, ...) gets the hard-coded
  // 200 instead of `data-minutes="Infinity"` at render time.
  const defaultWpm = normalizeWpm(rawWpm, 200)

  return definePlugin({
    name: 'reading-time',
    packageName: '@ampless/plugin-reading-time',
    instanceId,
    displayName: { en: 'Reading time', ja: '読了時間' },
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHtmlForPost', 'adminSettings'],

    settings: {
      public: [
        {
          type: 'number',
          key: 'wordsPerMinute',
          label: {
            en: 'Words per minute',
            ja: '1 分あたりの語数',
          },
          description: {
            en: 'Assumed reading speed. Typical adult reading speed is 200–250 WPM for English, roughly 400–500 characters per minute for Japanese.',
            ja: '想定読書速度。成人の平均は英語 200〜250 WPM、日本語 400〜500 文字/分が目安。',
          },
          min: 50,
          max: 1000,
          default: defaultWpm,
        },
        {
          type: 'text',
          key: 'labelTemplate',
          maxLength: 200,
          label: {
            en: 'Label template',
            ja: 'ラベルテンプレート',
          },
          description: {
            en: 'Template for the reading-time label. Use {minutes} for the minute count and {words} for the word count.',
            ja: 'ラベルのテンプレート。{minutes} で分数、{words} で語数を埋め込めます。',
          },
          default: defaultTemplate,
        },
        {
          type: 'select',
          key: 'position',
          label: {
            en: 'Position',
            ja: '表示位置',
          },
          description: {
            en: 'Where to inject the reading-time badge relative to the post content.',
            ja: 'バッジを本文の前後どちらに挿入するか。',
          },
          options: [
            {
              value: 'beforeContent',
              label: { en: 'Before content', ja: '本文の前' },
            },
            {
              value: 'afterContent',
              label: { en: 'After content', ja: '本文の後' },
            },
          ],
          default: defaultPosition,
        },
      ],
    },

    publicHtmlForPost(
      post: Post,
      ctx
    ): readonly PublicPostHtmlDescriptor[] {
      // Resolve settings — stored value wins, fall back to constructor
      // default. Both are normalized so a hand-edited DDB row or a
      // schema drift can't produce `Infinity min read` at the public
      // surface.
      const wpm = normalizeWpm(ctx.setting<number>('wordsPerMinute'), defaultWpm)
      const template =
        (ctx.setting<string>('labelTemplate') ?? '').trim() || defaultTemplate
      const position: 'beforeContent' | 'afterContent' =
        (ctx.setting<string>('position') as 'beforeContent' | 'afterContent') ??
        defaultPosition

      // Extract plain text and count words.
      const plainText = extractPlainText(post)
      const words = countWords(plainText)

      // No readable content — skip the badge entirely.
      if (words === 0) return []

      const minutes = Math.max(1, Math.ceil(words / wpm))

      // Substitute placeholders, then HTML-escape the result.
      const labelRaw = template
        .replace('{minutes}', String(minutes))
        .replace('{words}', String(words))
      const escapedLabel = escapeHtml(labelRaw)

      const body =
        `<p class="ampless-reading-time" data-words="${words}" data-minutes="${minutes}">${escapedLabel}</p>`

      return [
        {
          type: 'html',
          id: 'display',
          body,
          position,
        },
      ]
    },
  })
}
