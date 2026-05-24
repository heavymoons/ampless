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

## テーマのカスタマイズ（標準的な手順）

1. 公式テーマをコピーする:
   ```bash
   npm run copy-theme blog my-blog
   ```
   `my-` プレフィックスがついているコピーは `npm run update-ampless` で上書きされない。ターゲット名が `my-` で始まらない場合、コマンドは実行を拒否する。

2. 以下の優先順位で編集する:
   - `themes/my-blog/tokens.css` — 色、タイポグラフィ、スペーシング（`[data-theme='my-blog']` スコープの CSS カスタムプロパティ）。
   - `themes/my-blog/manifest.ts` — 管理 UI（`/admin/sites/<id>/theme`）に公開するフィールドの宣言。
   - `themes/my-blog/pages/` — レイアウト / 構造（Next.js ページモジュール: フィード、サイトマップ、投稿テンプレート）。

3. テーマを有効化する: `/admin/sites/<siteId>/theme` を開き、`my-blog` を選択する。テーマ切り替えはランタイム設定 — 再デプロイは不要。

4. 動作確認:
   ```bash
   npm run dev   # http://localhost:3000
   ```

## MCP サーバー（`@ampless/mcp-server`）

エージェントが投稿コンテンツを直接クエリ・編集できる。公開ツール: `list_posts`、`get_post`、`create_post`、`update_post`、`delete_post`、`upload_media`、`get_schema`。

登録方法:

プロジェクトルートの `.mcp.json` に追加する:
```json
{
  "mcpServers": {
    "ampless": {
      "command": "npx",
      "args": ["-y", "@ampless/mcp-server", "--outputs", "./amplify_outputs.json"],
      "env": {
        "AMPLESS_MCP_EMAIL": "<your-admin-email>",
        "AMPLESS_MCP_PASSWORD": "<your-admin-password>"
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

- `README.ja.md` — サイト運営者向けの日常利用ガイド。
- `RUNBOOK.ja.md` — 定期的な運用手順（キーローテーション、バックアップ復元など）。
- `themes/<name>/README.ja.md` — テーマごとのカスタマイズ詳細。
