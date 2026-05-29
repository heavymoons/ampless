> English: [README.md](./README.md)

# サイトローカルプラグイン

このディレクトリは **このサイト専用のプラグイン置き場**。別 npm
パッケージとして publish したくない小さなカスタマイズを書く場所。

`update-ampless` はこのディレクトリのファイルに一切触らない。ここに置いた
ものは消えない、上書きされない。

## いつ使うか

サイト固有の機能で、以下に当てはまるときに使う:

- プラグイン surface (`publicHead` / `publicBodyEnd` / `metadata` / `eventHooks` 等) が必要
- このサイト限定の用途 (一度きりのフッタークレジット、サイト特有の JSON-LD 拡張、まだ汎用化したくない analytics スニペット等)
- 別パッケージとして version 上げて publish するのは大袈裟

複数サイトで使いたくなったら、独立 npm パッケージに切り出す (Phase 5 で
`npx create-ampless plugin --standalone` が来る予定。今は手でコピーで OK)。

## 最小例

`plugins/footer-credit/index.ts`:

```typescript
import { definePlugin, type AmplessPlugin } from 'ampless'

export interface FooterCreditOptions {
  instanceId?: string
}

export default function footerCreditPlugin(
  options: FooterCreditOptions = {}
): AmplessPlugin {
  const instanceId = options.instanceId ?? 'footer-credit'
  return definePlugin({
    name: 'footer-credit',
    instanceId,
    apiVersion: 1,
    trust_level: 'untrusted',
    displayName: { en: 'Footer credit', ja: 'フッタークレジット' },
    capabilities: ['publicBody', 'adminSettings'],
    settings: {
      public: [
        {
          type: 'text',
          key: 'html',
          label: { en: 'Snippet', ja: 'スニペット' },
          default: '',
        },
      ],
    },
    publicBodyEnd(ctx) {
      const html = (ctx.setting<string>('html') ?? '').trim()
      if (!html) return []
      return [{ type: 'noscript', id: `footer-credit-${instanceId}`, html }]
    },
  })
}
```

`cms.config.ts` で register:

```typescript
import footerCreditPlugin from './plugins/footer-credit'

export default defineConfig({
  // ...
  plugins: [
    // ...既存 plugin...
    footerCreditPlugin(),
  ],
})
```

これだけ。`next dev` 再起動 → `/admin/plugins` でスニペットを設定すれば、
すべての公開ページの `</body>` 直前にレンダされる。

## 宣言できる surface

プラグインは `definePlugin({...})` で組み立てるただのオブジェクト。型は
`node_modules/ampless/dist/plugin.d.ts` を見るか、[プラグイン作者ガイド][guide]
の散文で。

現状 active な capability:

| capability | 用途 |
|---|---|
| `publicHead` | `<head>` に site-wide で挿入される descriptor |
| `publicBody` | `</body>` 直前に site-wide で挿入される descriptor |
| `metadata` | post ごとの Next.js Metadata 拡張 |
| `eventHooks` | trusted/untrusted の背景ハンドラ (content lifecycle / media event 等) |
| `adminSettings` | `settings.public[]` で宣言する admin 編集可能な設定 |
| `writePublicAsset` | trusted plugin が `public/plugins/<instanceId>/...` に書き込み |
| `schema` | post ごとの JSON-LD を `publicBodyForPost` 経由で (テーマ側で `ampless.publicBodyForPost(post)` を呼ぶ前提) |

[guide]: https://github.com/heavymoons/ampless/blob/main/packages/ampless/docs/plugin-author-guide.md

## TypeScript 設定

`tsconfig.json` の `**/*.ts` include glob でこのディレクトリも自動的に
カバーされている。`import x from './plugins/foo'` も
`import x from '@/plugins/foo'` も追加設定なしで動く。

## `update-ampless` はどうなるか

何もしない。`plugins/` は upgrade ツールの protected list に入っているので、
ここに置いたファイルは上書きも削除もされない。代償として **この README
も更新されない** — プラグイン API に大きな変更があるときは、本家リポジトリの
[プラグイン作者ガイド][guide] で最新版を確認すること。
