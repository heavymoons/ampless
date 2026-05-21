> English: [README.md](./README.md)
> 

# {{siteName}}

DADS テーマ — 公式の **[デジタル庁デザインシステム Tailwind プラグイン](https://github.com/digital-go-jp/tailwind-theme-plugin)**（`@digital-go-jp/tailwind-theme-plugin`、MIT）をベースに構築されています。カラーパレットとタイポグラフィは DADS 仕様に準拠しており、日本の行政機関・公共機関・公的な組織のサイトに適しています。

## プラグインが提供する機能

- **カラーパレット** — プライマリカラーに `solidBlue`（`#0017c1`）を使用し、DADS の全スケール（ライトブルー、シアン、グリーン、ライム、イエロー、オレンジ、レッド、マゼンタ）を Tailwind クラス（`bg-blue-900`、`text-blue-50` など）で利用可能
- **タイポグラフィ** — プラグイン経由で `fontFamily.sans` に Noto Sans JP を設定。`--ampless-body-font` として参照可能
- **ボーダー半径** — `rounded-4` / `rounded-6` が利用可能

`templates/dads/tokens.css` がプラグインの CSS 変数（`--color-blue-900` など）を ampless 標準のテーマ変数（`--primary`、`--background` など）にバインドするため、共有 chrome（SiteHeader、SiteFooter、shadcn ボタンなど）が自動的に DADS カラーで描画されます。

DADS が新しいパレットバージョンを公開した場合、`package.json` の `@digital-go-jp/tailwind-theme-plugin` をバージョンアップするだけでテーマに反映されます。

## カスタマイズ

`/admin/sites/<siteId>/theme` から設定できます：

- **ロゴ画像 URL** — ブランディング（組織マーク）
- **メインカラー** — デフォルトは DADS solidBlue。DADS 以外の色に変更するとサイトは DADS 準拠ではなくなります。
- **トップストーリースラッグ** — ヒーローとニュースの間に 1 件の公開済み投稿を特集表示
- **ヘッダーナビゲーション / フッターリンク / フッター欄外テキスト**

## 注意事項

- ダークモードは反転色による近似実装です。プラグイン 0.3.4 時点では DADS の公式ダークパレットは存在しません。公式ダークパレットが公開された際は、`templates/dads/tokens.css` のダーク変数バインディングを更新してください。
- このプラグインはデザイントークンのみを提供します。フル DADS コンポーネント（ボタン、アラート、タブなど）については [design-system-example-components](https://github.com/digital-go-jp/design-system-example-components) を参照し、必要に応じて適用してください。

## はじめに

```bash
npm install
npm run sandbox
```
