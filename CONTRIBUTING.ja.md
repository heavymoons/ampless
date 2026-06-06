> English: [CONTRIBUTING.md](./CONTRIBUTING.md)
> 

# ampless へのコントリビューション

コントリビューションへの関心をありがとうございます！

## 開発環境のセットアップ

```bash
# リポジトリをクローン
git clone https://github.com/YOUR_ORG/ampless.git
cd ampless

# 依存関係のインストール
pnpm install

# 全パッケージのビルド
pnpm build

# 開発モードで起動
pnpm dev
```

## プロジェクト構成

pnpm workspaces と Turborepo で管理されたモノリポです。

- `packages/ampless` — CMS コアライブラリ
- `packages/create-ampless` — CLI スキャフォールディングツール（`npx create-ampless@latest`）
- `packages/plugin-seo` — コア SEO プラグイン
- `templates/blog` — ブログスターターテンプレート

## プルリクエスト

1. リポジトリをフォークし、`main` からブランチを作成する
2. `pnpm changeset` を実行して変更内容をチェンジログに記述する
3. `pnpm build` と `pnpm test` が通ることを確認する
4. プルリクエストを開く

## セキュリティ

セキュリティ問題については public な issue を立て**ないで**ください。非公開の報告チャンネル (GitHub Security Advisories 推奨、メールもフォールバックとして使用可) については [SECURITY.md](./SECURITY.md) を参照してください。

## 行動規範

このプロジェクトは [Contributor Covenant 行動規範](./CODE_OF_CONDUCT.md) に準拠しています。参加することで、この規範を遵守することが期待されます。

## ライセンス

コントリビューションを行うことで、あなたの貢献が MIT ライセンスの下でライセンスされることに同意したものとみなします。
