> English: [README.md](./README.md)
> 

# {{siteName}}

[ampless](https://github.com/heavymoons/ampless) で構築したサイトです。**Landing** テーマを使用しています — ヒーロー主導のシングルページレイアウトで、オプションの「最新記事」グリッド、設定可能なヘッダー / フッターナビゲーション、ウォームコーラルのアクセントパレットを備えています。

## カスタマイズ

`/admin/sites/<siteId>/theme` から設定できます：

- ヒーローの見出し / サブ見出し / CTA ボタンのテキストと URL
- ヘッダーナビゲーション（ラベルと URL のペア）
- フッターリンク
- メインカラー
- 角丸の大きさ

ヒーローフィールドが空の場合、`/admin/sites/<siteId>` のサイト名 / 説明文にフォールバックします。

## はじめに

```bash
npm install
npm run sandbox        # AWS バックエンドをプロビジョニングし Next.js を起動
```

詳細なセットアップ手順はプロジェクトの README を参照してください。
