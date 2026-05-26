> English: [AGENTS.md](./AGENTS.md)
> 
# AGENTS.md

このファイルは AI コーディングエージェント（Claude Code, Cursor, Codex など）が読む前提で書かれています。人間向けの日常利用ガイドは `README.ja.md` と `RUNBOOK.ja.md` を参照してください。

## プロジェクトのレイアウト

- `themes/<name>/` — インストール済みのテーマ（tokens、pages、manifest）。アクティブテーマの切り替えは `/admin/sites/<id>/theme` で行う。
- `themes/my-<name>/` — ユーザーが所有するカスタマイズ済みのテーマコピー（`npm run copy-theme` で作成）。`my-` プレフィックスがついているコピーは `update-ampless` で上書きされない。
- `themes-registry.ts` — 自動生成ファイル。手動で編集しない。
- `amplify/` — TypeScript で定義された Amplify Gen 2 バックエンド（Cognito / DynamoDB / S3 / AppSync / Lambda）。
- `amplify_outputs.json` — `npm run sandbox` / Amplify Hosting が生成するファイル。編集しない。
- `app/` — Next.js 16 App Router（公開サイト + `/admin` UI）。
- `components/` — 共有 UI コンポーネント。
- `lib/` — 共有ユーティリティ（データアクセス、認証など）。
- `cms.config.ts` — サイト、プラグイン、デフォルト設定。
- `proxy.ts` — リクエストプロキシの設定。

## 触っていい場所・ダメな場所

**自由に編集可能:**
- `themes/my-*/` — ユーザー自身のテーマコピー。
- `cms.config.ts` — サイト / プラグインの設定。
- 投稿コンテンツは管理 UI（推奨）または MCP サーバー経由で操作する。

**注意して触る（編集前に理由を説明すること）:**
- `app/`、`components/`、`lib/` — 共有シェルの一部。`update-ampless` 後も編集は残るが、上流が同じファイルを変更した場合のマージはユーザー側の責任になる。テーマ関連の変更であれば、カスタムテーマ経由での拡張を優先する。
- `themes/<official-name>/`（`my-` プレフィックスなし）— 公式テーマは `update-ampless` で上書きされる。カスタマイズしたい場合は先に `npm run copy-theme <official-name> my-<your-name>` を実行し、コピーを編集する。
- `package.json` — `ampless` / `@ampless/*` のバージョンは一貫して管理する。バージョンアップには `update-ampless` を使う。

**編集禁止:**
- `themes-registry.ts` — scaffold / copy-theme / update コマンドが再生成する。
- `amplify/` — バックエンドのスキーマ変更はテーブルの再構築とサンドボックスデータの消失を招く可能性がある。触る前にユーザーの明示的な確認を得ること。
- `amplify_outputs.json` — `npm run sandbox` のたびに再生成される。
- `.amplify/` — Amplify CLI の作業ディレクトリ。
- `pnpm-lock.yaml` / `package-lock.json` — パッケージマネージャーに任せる。

## テーマのカスタマイズ

テーマのカスタマイズ手順 — ベーステーマの選び方、`themes/my-*/`
へのコピーフロー、Claude Design からの反映、AI 支援の実装、
レスポンシブの目視確認、Markdown 要素のデザイン方針、よくある失敗
— は [THEMES.ja.md](./THEMES.ja.md) を参照する。

## MCP サーバー（HTTP トランスポート）

エージェントが `mcp-handler` Lambda 経由で投稿コンテンツを直接クエリ・編集できる。公開ツール: `list_posts`、`get_post`、`create_post`、`update_post`、`delete_post`、`upload_media`、`get_schema`、`upload_static_bundle`、`list_static_files`、`delete_static_file`、`get_site_context`。

登録方法:

1. 管理画面の `/admin/mcp-tokens` で Bearer トークンを発行する。
2. Amplify コンソールまたは `amplify_outputs.json` で `mcp-handler` の Function URL を確認する。
3. プロジェクトルートの `.mcp.json` に追加する：

```json
{
  "mcpServers": {
    "ampless": {
      "url": "https://<function-url-id>.lambda-url.<region>.on.aws/",
      "transport": "http",
      "headers": {
        "Authorization": "Bearer amk_..."
      }
    }
  }
}
```

投稿本文は `markdown`、`html`、`tiptap`（JSON ドキュメント）の 3 フォーマットに対応している。

## 動作確認の基準

変更後は最低限以下を実行すること:

- `npm run dev` でブラウザから該当ページを開く。UI / テーマの変更は特に目視確認が必要（Playwright MCP が使える場合はスクリーンショットを活用する）。
- `npm run build` — 本番ビルドが成功することを確認する。
- `npm run lint`。

UI / テーマを変更した場合、型チェックだけを根拠にタスク完了を報告しない — ブラウザで実際に確認すること。

## 既知の制約

- **サンドボックスのデータは揮発性。** スキーマに影響する変更は API とテーブルの再構築を引き起こす可能性がある。サンドボックスのコンテンツは使い捨てとして扱うこと。本番データは永続する。
- **1 Amplify デプロイ = 1 サイト。** 複数サイトを別ドメインで配信したい場合は、サイトごとに Amplify 環境を分けてデプロイする。
- **AppSync 公開 API キーは `amplify_outputs.json` に含まれ、サイト訪問者から見える。** 低信頼の認証情報として扱うこと — このキーの権限は公開済み投稿の読み取りのみ。`api-key-renewer` Lambda が毎月自動ローテーションするため、手動ローテーションは不要。
- **最初に登録したユーザーが管理者になる。** 以降のロール変更は Cognito コンソールで行う（RUNBOOK 参照）。

## 参照先

- `THEMES.ja.md` — テーマカスタマイズの実務ガイド（ベーステーマの選び方、Claude Design からの反映、AI への依頼、ブラウザ確認、Markdown 要素のスタイリング、よくある失敗）。
- `README.ja.md` — サイト運営者向けの日常利用ガイド。
- `RUNBOOK.ja.md` — 定期的な運用手順（キーローテーション、バックアップ復元など）。
- `themes/<name>/README.ja.md` — テーマごとのカスタマイズ詳細。
