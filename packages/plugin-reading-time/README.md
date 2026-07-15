> 日本語版: [README.ja.md](./README.ja.md)
>

# @ampless/plugin-reading-time

Reading-time badge plugin for [ampless](https://github.com/heavymoons/ampless). Estimates the reading time of a post from its body text and injects a configurable label before or after the post content.

> **Pre-release / beta.** Breaking changes possible in any minor version until v1.0.

The badge is emitted via the `publicHtmlForPost` capability (Phase 6d). Themes that call `ampless.publicHtmlForPost(post)` automatically render it. The runtime sanitizes the HTML with `sanitize-html` under a strict allowlist before it reaches the page — no `dangerouslySetInnerHTML` needed in the theme.

No AWS data permissions are required — everything runs at request time inside the public Next.js process. The plugin's `trust_level` is `untrusted`.

## Install

```bash
npm install @ampless/plugin-reading-time@beta
```

## Configure

In `cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import readingTimePlugin from '@ampless/plugin-reading-time'

export default defineConfig({
  // ...
  plugins: [
    readingTimePlugin(),
  ],
})
```

| Option | Default | Notes |
|---|---|---|
| `wordsPerMinute` | `200` | Assumed reading speed. Typical adult reading speed is 200–250 WPM for English. |
| `labelTemplate` | `'{minutes} min read'` | Template for the label. Supports `{minutes}` and `{words}` placeholders. |
| `position` | `'beforeContent'` | `'beforeContent'` or `'afterContent'`. |
| `instanceId` | `'reading-time'` | Namespace used for runtime key resolution. Change only if registering the plugin twice. |

All options are also editable from `/admin/plugins → Reading time` without a redeploy — the constructor values above are just the initial defaults.

## Settings (admin UI)

Configure from `/admin/plugins → Reading time`:

| Key | Type | Default | Notes |
|---|---|---|---|
| `wordsPerMinute` | number | `200` | Min 50, max 1000. Reading speed assumption. |
| `labelTemplate` | text | `'{minutes} min read'` | Use `{minutes}` and `{words}` as placeholders. Max 200 chars. |
| `position` | select | `'beforeContent'` | `'beforeContent'` / `'afterContent'`. |

## Output HTML

The plugin emits a single `<p>` element:

```html
<p class="ampless-reading-time" data-words="480" data-minutes="3">3 min read</p>
```

- `data-words` — raw word count (after CJK normalization).
- `data-minutes` — computed reading time in minutes (always ≥ 1).
- The class `ampless-reading-time` is stable and suitable for CSS targeting. A modest default style (muted, smaller text) ships in the site template's `globals.css`, at zero specificity (`:where()`) so theme CSS can freely override it.

## Word counting

- **English:** whitespace-separated tokens.
- **CJK characters** (Han, Hiragana, Katakana): counted separately and divided by 2 to roughly match per-minute reading rates. Specifically: `CJK_chars / 2` reading units are added to the English word count.
- **Mixed language posts** combine both counts.

Format handling:

| `post.format` | How text is extracted |
|---|---|
| `tiptap` | Recursively walks the JSON tree, collecting `text` node values. |
| `markdown` | Strips fenced code, inline code, images, links syntax, bold/italic markers, and HTML tags. |
| `html` | Strips HTML tags. |
| `static` | Returns empty — no badge rendered. |

## Label escaping

The label string is HTML-escaped after placeholder substitution. Characters `< > & " '` become `&lt; &gt; &amp; &quot; &#39;` respectively, preventing XSS even when a site operator stores angle brackets in the `labelTemplate` admin setting.

## Trust level

`untrusted`. The plugin only emits an HTML descriptor validated and sanitized by `@ampless/runtime`. It does not access DynamoDB, S3, or any Lambda processor.

## What it does not do (v1)

- **Theme CSS** — The `<p>` element carries a stable class name (`ampless-reading-time`) for theme authors to style. A modest default style (muted, smaller text) ships in the site template's `globals.css`; the rule is zero-specificity (`:where()`) so themes can freely override it.
- **Locale-aware labels** — The `labelTemplate` is a single string shared across all locales. Multi-locale setups can register the plugin twice with distinct `instanceId` values and theme-side conditionally render the correct slot.
- **Custom WPM per script** — The `wordsPerMinute` setting applies uniformly. Fine-grained per-script tuning (e.g. different rates for Arabic vs. Latin) is deferred.
