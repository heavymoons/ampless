# @ampless/plugin-x-embed

> 日本語版: [README.ja.md](./README.ja.md)

Inline x.com (Twitter) embeds for ampless posts. Renders `https://x.com/<handle>/status/<id>` and `https://twitter.com/<handle>/status/<id>` URLs as `<blockquote class="twitter-tweet">` elements that x's `widgets.js` hydrates into the rich embed card.

## Install

```sh
npm i @ampless/plugin-x-embed
```

## Wire up

`cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import xEmbedPlugin from '@ampless/plugin-x-embed'

export default defineConfig({
  plugins: [xEmbedPlugin()],
})
```

For the tiptap editor side, register the Node in `templates/_shared/app/(admin)/admin/_editor-bootstrap.tsx`:

```tsx
'use client'
import { installAdminEditorExtensions } from '@ampless/admin/editor'
import { tweetEditor } from '@ampless/plugin-x-embed/editor'

export function EditorBootstrap({ children }: { children: React.ReactNode }) {
  installAdminEditorExtensions([tweetEditor.extension])
  return <>{children}</>
}
```

Then thread it into `createAdminLayout(admin, { editorBootstrap: EditorBootstrap })`.

## Page-level script (widgets.js)

The plugin declares the `publicPostScript` capability. Themes that already call `{await ampless.publicPostScriptsForPage([post])}` (the first-party themes all do as of Phase 7) automatically pick up `platform.twitter.com/widgets.js` — emitted once per page when any post on that page contains a tweet.

## CSP

The page-level script loads `platform.twitter.com/widgets.js`, which in turn hydrates `<blockquote>` elements into iframes pointing at `platform.twitter.com`. Your site's CSP needs:

- `script-src https://platform.twitter.com`
- `frame-src https://platform.twitter.com`

## License

MIT
