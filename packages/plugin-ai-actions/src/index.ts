// @ampless/plugin-ai-actions — human-to-AI bridge links on post pages.
//
// Injects a `<p class="ampless-ai-actions">` element before or after the
// post content via the `publicHtmlForPost` capability. Up to three `<a>`
// links can appear:
//
//  - "View as Markdown" (default ON) — links to the post's `/<slug>.md`
//    markdown projection (see `@ampless/runtime`'s `.md` route).
//  - "Open in Claude" (default OFF, opt-in) — `https://claude.ai/new?q=...`
//    prefilled with a prompt that references the absolute `.md` URL.
//  - "Open in ChatGPT" (default OFF, opt-in) — same idea, `https://chatgpt.com/?q=...`.
//
// The two external links are OFF by default: the `?q=` prefill query
// param is a widely-used community convention, not a documented, versioned
// URL contract from Anthropic or OpenAI. Site operators should verify the
// prefill behaves as expected (logged-in desktop + mobile) before opting
// in — see README.md / README.ja.md.
//
// "Copy Markdown" (clipboard) is intentionally NOT implemented: the
// `publicHtmlForPost` sanitizer drops `onclick` / any inline JS channel
// (see `SANITIZE_OPTIONS` in `packages/runtime/src/plugin-head.ts`), and
// `publicPostScript` only supports external absolute `http(s)` script
// `src`, not inline script bodies. Without an inline-script capability or
// a plugin asset delivery mechanism, there is no plugin surface that can
// write to the clipboard. "View as Markdown" + "select all + copy" is the
// pragmatic substitute for now.
//
// All three links require `ai.markdownRoutes` to be enabled (the default)
// on the site — see README.md / README.ja.md for the "do not register
// this plugin if markdownRoutes is disabled" guidance.
//
// Architecture: https://github.com/heavymoons/ampless/wiki/architecture-08-plugin-architecture — publicHtmlForPost.

import { definePlugin, type AmplessPlugin, type PublicPostHtmlDescriptor } from 'ampless'
import type { Post } from 'ampless'

export type AiActionsPosition = 'beforeContent' | 'afterContent'

export interface AiActionsOptions {
  /** Show the "View as Markdown" link. Default `true`. */
  showMarkdownLink?: boolean
  /**
   * Show the "Open in Claude" link. Default `false` — opt-in.
   * `https://claude.ai/new?q=` prefill is a community convention, not a
   * documented URL contract; verify it works for your site before
   * enabling. See README.md.
   */
  showClaude?: boolean
  /**
   * Show the "Open in ChatGPT" link. Default `false` — opt-in. Same
   * caveat as `showClaude`: `https://chatgpt.com/?q=` prefill is not a
   * documented, versioned contract.
   */
  showChatgpt?: boolean
  /**
   * Prompt template used to build the `?q=` query param for the Claude /
   * ChatGPT links. `{url}` is replaced with the absolute `.md` URL of the
   * post, then the whole string is `encodeURIComponent`-escaped. Default
   * `'Read {url}'`.
   */
  promptTemplate?: string
  /**
   * Where to inject the actions relative to the post body. Default
   * `'afterContent'` — read the article first, then offer the AI actions
   * (intentionally the opposite of `@ampless/plugin-reading-time`'s
   * `'beforeContent'` default).
   */
  position?: AiActionsPosition
  /**
   * Optional namespace for this instance. Defaults to `'ai-actions'`.
   * Set a distinct value if registering the plugin more than once.
   */
  instanceId?: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Escape characters that have special meaning in HTML attribute values and
 * text content. Same narrow five-character escape used by
 * `@ampless/plugin-reading-time` — no external library needed for this
 * use case (the runtime's `sanitize-html` pass is the actual safety
 * boundary; this is defense in depth on the string we hand it).
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Alias for readability at call sites that build `href="..."` values.
const escapeAttr = escapeHtml

/**
 * MDN's fixedEncodeURIComponent, kept in sync with the same-named helper
 * in `packages/runtime/src/routes/llms.ts`: `encodeURIComponent` leaves
 * `! ' ( ) *` unescaped (valid in a URI per RFC 3986), but a raw `(` / `)`
 * in a slug would look odd unescaped in a URL and, more importantly,
 * `'` / `"` left bare could complicate naive string-based HTML assembly
 * downstream. Percent-encoding all five keeps this plugin's slug handling
 * identical to the runtime's `.md` link builder.
 */
function fixedEncodeURIComponent(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  )
}

/** Strip a trailing slash run from a site URL before concatenating a path. */
function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, '')
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Factory for the AI-actions plugin. Returns a plugin that injects a
 * `<p class="ampless-ai-actions">` element containing up to three links
 * (View as Markdown / Open in Claude / Open in ChatGPT) before or after
 * the post body via the `publicHtmlForPost` capability. Emits no
 * descriptor at all when every link resolves to hidden.
 *
 * Usage in `cms.config.ts` (only if `ai.markdownRoutes` is enabled —
 * the default — since every link this plugin renders points at the
 * post's `/<slug>.md` route):
 *
 * ```ts
 * import aiActionsPlugin from '@ampless/plugin-ai-actions'
 *
 * export default defineConfig({
 *   plugins: [aiActionsPlugin()],
 * })
 * ```
 *
 * All options are also editable from `/admin/plugins → AI actions`
 * without a redeploy — the constructor values below are the initial
 * defaults.
 */
export default function aiActionsPlugin(
  options: AiActionsOptions = {}
): AmplessPlugin {
  const {
    showMarkdownLink: defaultShowMarkdownLink = true,
    showClaude: defaultShowClaude = false,
    showChatgpt: defaultShowChatgpt = false,
    promptTemplate: defaultPromptTemplate = 'Read {url}',
    position: defaultPosition = 'afterContent',
    instanceId,
  } = options

  return definePlugin({
    name: 'ai-actions',
    packageName: '@ampless/plugin-ai-actions',
    instanceId,
    displayName: { en: 'AI actions', ja: 'AI アクション' },
    apiVersion: 1,
    trust_level: 'untrusted',
    capabilities: ['publicHtmlForPost', 'adminSettings'],

    settings: {
      public: [
        {
          type: 'boolean',
          key: 'showMarkdownLink',
          label: {
            en: 'Show "View as Markdown" link',
            ja: '「Markdown で表示」リンクを表示',
          },
          description: {
            en: 'Links to the post\'s /<slug>.md projection. Requires ai.markdownRoutes to be enabled in cms.config.ts.',
            ja: '投稿の /<slug>.md への相対リンク。cms.config.ts の ai.markdownRoutes が有効である必要があります。',
          },
          default: defaultShowMarkdownLink,
        },
        {
          type: 'boolean',
          key: 'showClaude',
          label: {
            en: 'Show "Open in Claude" link',
            ja: '「Claude で開く」リンクを表示',
          },
          description: {
            en: 'Opt-in: links to https://claude.ai/new?q=... prefilled with the prompt template below. This URL prefill is a community convention, not a documented contract — verify it works on your site (logged-in desktop + mobile) before enabling.',
            ja: 'opt-in: 下記のプロンプトテンプレートで prefill した https://claude.ai/new?q=... へのリンク。この URL prefill は公式に文書化された契約ではなくコミュニティ慣習です。有効化前に自サイトで動作確認（ログイン済み PC / モバイル）してください。',
          },
          default: defaultShowClaude,
        },
        {
          type: 'boolean',
          key: 'showChatgpt',
          label: {
            en: 'Show "Open in ChatGPT" link',
            ja: '「ChatGPT で開く」リンクを表示',
          },
          description: {
            en: 'Opt-in: links to https://chatgpt.com/?q=... prefilled with the prompt template below. Same caveat as "Open in Claude" — this is a community convention, not a documented contract.',
            ja: 'opt-in: 下記のプロンプトテンプレートで prefill した https://chatgpt.com/?q=... へのリンク。「Claude で開く」と同様、公式に文書化された契約ではなくコミュニティ慣習です。',
          },
          default: defaultShowChatgpt,
        },
        {
          type: 'text',
          key: 'promptTemplate',
          maxLength: 500,
          label: {
            en: 'Prompt template',
            ja: 'プロンプトテンプレート',
          },
          description: {
            en: 'Template for the Claude / ChatGPT prefill prompt. Use {url} for the absolute .md URL of the post.',
            ja: 'Claude / ChatGPT の prefill プロンプトのテンプレート。{url} で投稿の絶対 .md URL を埋め込めます。',
          },
          default: defaultPromptTemplate,
        },
        {
          type: 'select',
          key: 'position',
          label: {
            en: 'Position',
            ja: '表示位置',
          },
          description: {
            en: 'Where to inject the AI actions relative to the post content.',
            ja: 'AI アクションを本文の前後どちらに挿入するか。',
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
      const showMarkdownLink =
        ctx.setting<boolean>('showMarkdownLink') ?? defaultShowMarkdownLink
      const showClaude = ctx.setting<boolean>('showClaude') ?? defaultShowClaude
      const showChatgpt = ctx.setting<boolean>('showChatgpt') ?? defaultShowChatgpt
      const promptTemplate =
        (ctx.setting<string>('promptTemplate') ?? '').trim() || defaultPromptTemplate
      const position: AiActionsPosition =
        (ctx.setting<string>('position') as AiActionsPosition) ?? defaultPosition

      const relativeMdUrl = `/${fixedEncodeURIComponent(post.slug)}.md`
      const siteUrl = stripTrailingSlashes((ctx.site.url ?? '').trim())
      // No usable absolute URL to hand to an external AI service — the
      // View link still works (it's relative), but Claude/ChatGPT can't.
      const absoluteMdUrl = siteUrl ? `${siteUrl}${relativeMdUrl}` : null

      const buttons: string[] = []

      if (showMarkdownLink) {
        buttons.push(
          `<a class="ampless-ai-actions-md" href="${escapeAttr(relativeMdUrl)}">View as Markdown</a>`
        )
      }

      if (showClaude && absoluteMdUrl) {
        const q = encodeURIComponent(promptTemplate.replace('{url}', absoluteMdUrl))
        const href = `https://claude.ai/new?q=${q}`
        buttons.push(
          `<a class="ampless-ai-actions-claude" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">Open in Claude</a>`
        )
      }

      if (showChatgpt && absoluteMdUrl) {
        const q = encodeURIComponent(promptTemplate.replace('{url}', absoluteMdUrl))
        const href = `https://chatgpt.com/?q=${q}`
        buttons.push(
          `<a class="ampless-ai-actions-chatgpt" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">Open in ChatGPT</a>`
        )
      }

      // No enabled buttons — skip the wrapper entirely rather than
      // rendering an empty <p>.
      if (buttons.length === 0) return []

      const body = `<p class="ampless-ai-actions">${buttons.join('<span class="ampless-ai-actions-sep"> · </span>')}</p>`

      return [
        {
          type: 'html',
          id: 'actions',
          body,
          position,
        },
      ]
    },
  })
}
