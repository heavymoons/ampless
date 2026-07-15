> English: [README.md](./README.md)

# サイトローカルプラグイン

このディレクトリは **このサイト専用のプラグイン置き場**。別 npm
パッケージとして publish したくない小さなカスタマイズを書く場所。

`update-ampless` はこのディレクトリのファイルに一切触らない。ここに置いた
ものは消えない、上書きされない。

## いつ使うか

詳しい判断軸は [プラグイン作者ガイド](../docs/plugin-author-guide.ja.md)
§0「テーマとプラグインの境界線」に書いてある。プラグインが初めて、または
「これはテーマ側に書くべきか、プラグインか」で迷ったら先にそちらを読む。
ざっくり言うと:

- **テーマ** = ページの見た目 (レイアウト / コンポーネント / CSS)
- **プラグイン** = admin で編集する設定、バックグラウンド処理、
  テーマを横断する注入、機械可読メタデータ、複数サイトで共有したい機能

その中でも *ローカル* プラグイン (このディレクトリ) を使うのは、サイト
固有の機能で:

- プラグイン surface (`publicHead` / `publicBodyEnd` / `metadata` /
  `eventHooks` 等) が必要
- このサイト限定の用途 (一度きりのフッタークレジット、サイト特有の
  JSON-LD 拡張、まだ汎用化したくない analytics スニペット等)
- 別パッケージとして version 上げて publish するのは大袈裟

複数サイトで使いたくなったら、独立 npm パッケージに切り出す:
`npx create-ampless@beta plugin <name> --standalone` で publish 用の
ディレクトリ一式が scaffold される。

## クライアントサイドスクリプトに関する注意

`publicHead` / `publicBodyEnd` で `inlineScript` を返す場合、その body の
中で **可視 DOM 要素を挿入してはいけない**。React の hydration は DOM が
virtual DOM と一致していることを前提にしていて、外部からの DOM 操作は
reconciliation で消されてコンソールに hydration error が出る。
安全なパターンは `window.dataLayer` 等のグローバル状態操作、自分で隔離
コンテナを持つ外部ウィジェットローダ、そして SSR 専用 descriptor (`meta` /
`link` / `noscript` / `iframe`)。詳細は [作者ガイド §6](../docs/plugin-author-guide.ja.md)
「クライアント側 DOM 変更は禁止」セクションを参照。

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
| `publicHtmlForPost` | post ごとの可視 HTML（読了時間バッジ等）を `publicHtmlForPost` 経由で（テーマ側で `ampless.publicHtmlForPost(post)` を呼ぶ前提） |

**`publicHtmlForPost` を使うファーストパーティプラグイン:**
- `@ampless/plugin-reading-time` — 投稿本文から読了時間を推定し、本文の前後に設定可能なバッジを注入します。
- `@ampless/plugin-ai-actions` — 「Markdown で表示」リンク（デフォルトオン）と、opt-in の「Claude で開く」「ChatGPT で開く」リンクを本文の後（または前）に追加します。`ai.markdownRoutes` の有効化が前提です。

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
