# @ampless/plugin-youtube

> English: [README.md](./README.md)

ampless の投稿に YouTube 埋め込みをインラインで表示するプラグイン。`https://youtu.be/<id>` および `https://www.youtube.com/watch?v=<id>` 形式の URL を、プライバシー強化された `youtube-nocookie.com` 上の `<iframe>` 要素として描画する（再生開始まで cookie を設定しない）。

## インストール

```sh
npm i @ampless/plugin-youtube
```

## 配線

`cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import youtubePlugin from '@ampless/plugin-youtube'

export default defineConfig({
  plugins: [youtubePlugin()],
})
```

tiptap エディタ側は `templates/_shared/app/(admin)/admin/_editor-bootstrap.tsx` で Node を登録する:

```tsx
'use client'
import { installAdminEditorExtensions } from '@ampless/admin/editor'
import { youtubeEditor } from '@ampless/plugin-youtube/editor'

export function EditorBootstrap({ children }: { children: React.ReactNode }) {
  installAdminEditorExtensions([youtubeEditor.extension])
  return <>{children}</>
}
```

その上で `createAdminLayout(admin, { editorBootstrap: EditorBootstrap })` に渡す。

## 動作

- `amplessYoutube` 型の tiptap ノード（エディタのペーストルールまたは `setYoutube({ videoId })` コマンドで挿入）は YouTube の iframe としてレンダリングされる。
- markdown 投稿で単独行が YouTube URL の段落（例: 段落の中身が `https://youtu.be/dQw4w9WgXcQ` だけ）も iframe としてレンダリングされる。
- 段落内インラインの URL はそのまま残る。単独行の URL のみ置換対象。

## CSP

本プラグインは `<iframe src="https://www.youtube-nocookie.com/...">` を出力する。サイト側の CSP（`next.config.ts` / middleware で設定）の `frame-src` に `youtube-nocookie.com` を含める必要がある。

## License

MIT
