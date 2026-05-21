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
  ampless/           — CMS コアライブラリ (npm: ampless)
  create-ampless/    — CLI スキャフォールドツール (npm: create-ampless)
  plugin-seo/        — SEO プラグイン (npm: @ampless/plugin-seo)
templates/
  blog/              — ブログスターターテンプレート (create-ampless CLI でコピーされる)
```

## 技術スタック

- **ランタイム:** Node.js >= 20
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
- コンテンツは Portable Text (構造化 JSON) で保存
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

初期開発中 (private repo)。最初の公開リリースとして v0.1.0 を目指す。
