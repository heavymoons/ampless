> English: [CLAUDE.md](./CLAUDE.md)
> 
# ampless — Claude Code プロジェクトガイド

## プロジェクト概要

ampless は AWS Amplify Gen 2 上に構築された**エンジニア向けのカスタマイズベース CMS**。エンジニアは TypeScript でテーマ・プラグイン・スキーマを自由にカスタマイズでき、非エンジニアは投稿・メディア・設定の管理に polished な admin UI を使う。詳しいポジショニングと trust framework のスコープは下の `## Positioning` セクションを、設計詳細は ARCHITECTURE.ja.md を参照。

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
- **新規パッケージは作成と同時に `packages/<pkg>/CHANGELOG.md` を入れる**（中身は `# @ampless/<pkg>` だけで OK）。`changesets/action` が Version Packages PR の本文を組み立てる際にこのファイルを読むので、無いと `ENOENT` で crash する。

### feature PR 作業中にローカルで `changeset version` を叩かない

`pnpm changeset version` / `pnpm version-packages` / `pnpm release` / `pnpm changeset pre exit|enter` は CI 専用。feature PR 中にローカルで実行すると `.changeset/pre.json` の `changesets` 配列を書き換えてしまい、その pre.json を `.md` と一緒に commit すると `main` 上で「既に consumed 済み」状態になる → **作った changeset 用の Version Packages PR が開かれず**、バンプが黙って消える。これで 2 回事故った (#135, #139) ため明文化。

イテレーション中に安全に叩けるコマンド:

- `pnpm changeset` — 新規 `.md` のインタラクティブスキャフォールド
- `.changeset/<slug>.md` を手書き
- `pnpm changeset status` — 読み取り専用、今 version を叩いたらどの bump になるか表示

ステイル状態がすり抜けて症状（Release workflow が `No changesets found` と出して VP PR が開かない）が出た場合は、`.md` には触らず `pre.json` から該当エントリを 1 行削除する小さな修正 PR で復旧する。詳しい運用とリカバリ手順は [docs/release-workflow.ja.md](./docs/release-workflow.ja.md)。

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
- CLI: `create-ampless` (`npx create-ampless@beta` で起動)
- プラグイン: `@ampless/plugin-*`

## ポジショニング

ampless は**エンジニア向けのカスタマイズベース CMS** です — 非エンジニアはデフォルトのままでも使えます。

- **エンジニア（ビルダー）**: `cms.config.ts` を編集し、プラグインを npm インストールし、テーマをフォーク / 編集し、AWS にデプロイする
- **オペレーター（非エンジニア）**: ポリッシュされた admin UI で投稿 / メディア / settings.public / シークレット入力を行う
- **プラグインモデル**: プラグインはエンジニアが `cms.config.ts` で直接インポート + 設定する npm dep（Astro integration / Next.js plugin パターン）。サイトエンジニアが各 npm dep をインストール前に審査する
- **trust framework のスコープ（`trust_level`、capabilities、IAM スコープ付き Lambda）**: v1 において**ファーストパーティプラグインの code organization**として実装済み — どの trust 階層の Lambda が各イベントフックを実行するか、各階層が保有する IAM 権限、狭い範囲の hard gate（例: `settings.secret` は `trust_level: 'trusted'` を要求）。ほとんどの capability 宣言は**不一致 warning・admin ラベル・将来の allow-list**をサポートしており、runtime の hard gate ではない。任意のサードパーティ未審査プラグインを自動的に安全に動かすための marketplace-grade automatic sandbox としては設計されていない。サードパーティプラグインの安全性はエンジニアの責任（インストール前に審査する）
- **マーケットプレイス / ランタイムサンドボックス**: 明示的に v1.0 の成果物では**ない**。サイトエンジニアが審査していないプラグインを安全に動かす必要がある場合（つまり本物のプラグインマーケットプレイス）のみ v2.0+ で探索する

参照カテゴリ: **Statamic / Craft / Sanity / Wagtail / Strapi**（エンジニアカスタマイズ + 編集者向けポリッシュ admin）。WordPress ではない（admin ファースト / 非エンジニアによるプラグインインストールホスト）。

## ステータス

ampless は 4 段階のリリースパスを歩んでいます: **alpha → beta → RC → stable**。現在は **beta**: リポジトリは公開され、`main` ブランチから changesets 経由で `beta` dist-tag として npm に公開中で、破壊的変更はまだあり得ます。**Alpha** はクローズド dogfood 期間でした。**RC** は feature-complete で破壊的変更なし。**v1.0 stable** は ampless の紹介ページ（ampless 自身で構築）と同時ローンチ。
