> English: [CLAUDE.md](./CLAUDE.md)
> 
# ampless — Claude Code プロジェクトガイド

## プロジェクト概要

ampless は AWS Amplify 向けのサーバーレス CMS で、「AWS 版 EmDash」のポジションを目指す。
設計詳細は ARCHITECTURE.ja.md を参照。

## リポジトリ構成

pnpm workspaces + Turborepo + changesets で管理する monorepo。

```
packages/
  ampless/           — CMS コアライブラリ、フック、型 (npm: ampless)
  admin/             — 管理画面のコンポーネント / プロバイダ / フック (npm: @ampless/admin)
  runtime/           — Next.js ランタイム: ミドルウェア、ディスパッチャー、公開ルート (npm: @ampless/runtime)
  backend/           — Amplify Gen 2 バックエンド配線 + AppSync スキーマ (npm: @ampless/backend)
  mcp-server/        — MCP ツールレジストリ、stdio + HTTP トランスポート (npm: @ampless/mcp-server)
  create-ampless/    — CLI スキャフォールド / アップグレードツール (npm: create-ampless)
  plugin-seo/        — SEO メタプラグイン (npm: @ampless/plugin-seo)
  plugin-rss/        — RSS フィードプラグイン (npm: @ampless/plugin-rss)
  plugin-og-image/   — OG 画像生成プラグイン (npm: @ampless/plugin-og-image)
  plugin-webhook/    — 外向き Webhook プラグイン (npm: @ampless/plugin-webhook)
templates/
  _shared/           — テーマ非依存の app/ ツリー + Amplify バックエンド (create-ampless でコピー)
  blog/              — Blog テーマオーバーレイ
  corporate/         — Corporate テーマオーバーレイ
  dads/              — DADS (デジタル庁デザインシステム) テーマオーバーレイ
  docs/              — Docs / ハンドブック向けテーマオーバーレイ
  landing/           — 1 ページ LP 向けテーマオーバーレイ
  minimal/           — ミニマル / ヘッドレス向けテーマオーバーレイ
```

## 技術スタック

- **ランタイム:** Node.js >= 22.13 (pnpm 11 が要求)
- **言語:** TypeScript (ESM のみ)
- **パッケージマネージャ:** pnpm (workspaces)
- **ビルド:** tsup (パッケージごと)
- **テスト:** vitest
- **Lint:** ESLint + Prettier
- **バージョニング:** changesets (パッケージごとに独立)
- **CI:** GitHub Actions

## コマンド

```bash
pnpm install          # 全依存関係をインストール
pnpm build            # 全パッケージをビルド (Turborepo 経由)
pnpm test             # 全テストを実行
pnpm lint             # 全パッケージを lint
pnpm changeset        # バージョニング用 changeset を作成
```

## 規約

- 全パッケージは ESM 出力 (`"type": "module"`)
- TypeScript の共通設定は `tsconfig.base.json`、各パッケージはそれを extends
- 各パッケージは独自の `tsup.config.ts` を持つ
- CLI の対話プロンプトには `@clack/prompts` を使う (inquirer は使わない)
- 投稿は `format` フィールド (`tiptap` / `markdown` / `html` / `static`) を持ち、本文の形は宣言した format に従う。`tiptap` は tiptap ドキュメント JSON、`markdown` / `html` はソース文字列、`static` は S3 にアップロード済みバンドルを指すマニフェスト。
- プラグインの信頼レベル: untrusted / trusted / privileged (ARCHITECTURE.ja.md §4 参照)

## Changeset ポリシー

- **公開パッケージに触る PR は必ず `.changeset/` に changeset を入れる**。README のような doc-only 編集も対象（README は npm tarball に同梱されて配布されるので、再公開しないとユーザーに届かない）。
- `pnpm changeset` でスキャフォールドするか、`.changeset/<slug>.md` に手書きする。frontmatter は `"<package>": patch | minor | major` の形式。
- バンプの目安: ドキュメント / バグ修正は `patch`、機能追加は `minor`、破壊的変更は `major`。1.0 前は破壊的でも `minor` に留め、本文で明示する。
- 複数パッケージにまたがる PR は changeset の frontmatter に全パッケージを並べる。
- リポジトリ全体だけに関わる変更（ルートの `README.md`、CI 設定、`CLAUDE.md`、トップレベルの `docs/`）は tarball に同梱されないので changeset 不要。
- Version Packages bot が溜まった changeset からリリース PR を起こす。それを merge すると npm publish ワークフローが走る。changeset を入れ忘れると修正がユーザーに届かない。

## ドキュメント言語ポリシー

- **`*.md` の主言語は英語。** 新規ドキュメントは `name.md` に英語で記述する。
- **日本語訳は `name.ja.md`** として英語版と並べて配置する (例: `README.md` ↔ `README.ja.md`、`docs/architecture/01-overview.md` ↔ `docs/architecture/01-overview.ja.md`)。
- 各ファイルは先頭で他言語版へのリンクを示す:
  - 英語版: `> 日本語版: [README.ja.md](./README.ja.md)`
  - 日本語版: `> English: [README.md](./README.md)`
- ドキュメントを更新するときは**両言語版を同じ変更内で更新する**。片方だけ更新する場合は、もう片方が pending である旨を PR に記載する。
- 自動生成ファイル (`CHANGELOG.md`、`.changeset/*.md`) は対象外で、英語単一のままにする。
- package / template の `README.md` も翻訳がある場合は同じルールに従う。ない場合は英語のみでも可。

## ローカル作業メモ

- 開発中の一時メモ、レビューまとめ、設計のスクラッチ、エージェント間の引き継ぎファイルなど、ローカルだけで使うドキュメントは `docs/tmp/` 配下に置く。このディレクトリは gitignore されているので、コミットされず手元に留まる。
- 自分用のメモ置き場、または未確定 / 公開予定のないコンテキスト引き継ぎ用に使う。共有できる段階になったら通常の `docs/` パスへ移動し、上記の言語ポリシーに従う。

## AWS / Amplify 固有事項

- Amplify Gen 2 (CDK ベース、TypeScript)
- コンテンツ保存は DynamoDB (RDS ではない)
- メディアファイルは S3
- 認証は Cognito
- プラグイン実行は Lambda (IAM ベースのサンドボックス、V8 isolate ではない)

## npm パッケージ

- スコープ: `@ampless` (npm org 取得済み)
- コアパッケージ: `ampless`
- CLI: `create-ampless` (`npx create-ampless@latest` で起動)
- プラグイン: `@ampless/plugin-*`

## ステータス

private repo でクローズドアルファ開発中。`main` ブランチから changesets 経由で `alpha` dist-tag として npm に公開している。最初の公開リリースのターゲットは **v1.0 RC**: ampless で自前のドッグフードサイトを運用できる状態を目指す（マーケットプレイスは v1.0 の必須要件ではない）。
