# @ampless/plugin-youtube

> 日本語版: [README.ja.md](./README.ja.md)

Inline YouTube embeds for ampless posts. Renders `https://youtu.be/<id>` and `https://www.youtube.com/watch?v=<id>` URLs as `<iframe>` elements pointing at `youtube-nocookie.com` (the privacy-enhanced embed host that does not set cookies before playback starts).

## Install

```sh
npm i @ampless/plugin-youtube
```

## Wire up

`cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import youtubePlugin from '@ampless/plugin-youtube'

export default defineConfig({
  plugins: [youtubePlugin()],
})
```

For the tiptap editor side, register the Node in `templates/_shared/app/(admin)/admin/_editor-bootstrap.tsx`:

```tsx
'use client'
import { installAdminEditorExtensions } from '@ampless/admin/editor'
import { youtubeEditor } from '@ampless/plugin-youtube/editor'

export function EditorBootstrap({ children }: { children: React.ReactNode }) {
  installAdminEditorExtensions([youtubeEditor.extension])
  return <>{children}</>
}
```

Then thread it into `createAdminLayout(admin, { editorBootstrap: EditorBootstrap })`.

## Behaviour

- Tiptap nodes typed `amplessYoutube` (inserted via the editor's paste rule or the `setYoutube({ videoId })` command) render as a YouTube iframe.
- Markdown posts with a single-line YouTube URL (e.g. a paragraph whose entire content is `https://youtu.be/dQw4w9WgXcQ`) also render as an iframe.
- Inline URLs in the middle of a paragraph are left as-is — only single-line URLs convert.

## CSP

The plugin emits `<iframe src="https://www.youtube-nocookie.com/...">`. Your site's CSP (configured in `next.config.ts` / middleware) needs to include `youtube-nocookie.com` in `frame-src` for the embed to load.

## License

MIT
