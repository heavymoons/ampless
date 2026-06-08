# @ampless/plugin-x-embed

> English: [README.md](./README.md)

ampless の投稿に x.com (Twitter) 埋め込みをインラインで表示するプラグイン。`https://x.com/<handle>/status/<id>` および `https://twitter.com/<handle>/status/<id>` 形式の URL を `<blockquote class="twitter-tweet">` として描画し、x の `widgets.js` がカード型の埋め込みに hydrate する。

## インストール

```sh
npm i @ampless/plugin-x-embed
```

## 配線

`cms.config.ts`:

```ts
import { defineConfig } from 'ampless'
import xEmbedPlugin from '@ampless/plugin-x-embed'

export default defineConfig({
  plugins: [xEmbedPlugin()],
})
```

tiptap エディタ側は `templates/_shared/app/(admin)/admin/_editor-bootstrap.tsx` で Node を登録する:

```tsx
'use client'
import { installAdminEditorExtensions } from '@ampless/admin/editor'
import { tweetEditor } from '@ampless/plugin-x-embed/editor'

export function EditorBootstrap({ children }: { children: React.ReactNode }) {
  installAdminEditorExtensions([tweetEditor.extension])
  return <>{children}</>
}
```

その上で `createAdminLayout(admin, { editorBootstrap: EditorBootstrap })` に渡す。

## ページレベルスクリプト (widgets.js)

本プラグインは `publicPostScript` capability を宣言している。`{await ampless.publicPostScriptsForPage([post])}` を呼んでいるテーマ（Phase 7 以降の first-party テーマはすべて該当）は、ページ上の投稿のいずれかに tweet 埋め込みが含まれる場合に `platform.twitter.com/widgets.js` を 1 回だけ出力する。

## CSP

ページレベルスクリプトは `platform.twitter.com/widgets.js` を読み込み、これが `<blockquote>` 要素を `platform.twitter.com` を src とする iframe に置き換える。サイト側 CSP には以下が必要:

- `script-src https://platform.twitter.com`
- `frame-src https://platform.twitter.com`

## License

MIT
