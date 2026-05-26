> English: [12-setup-experience.md](./12-setup-experience.md)
> 
## 12. セットアップ体験

### 新規プロジェクトのスキャフォールド

`create-ampless` がエントリポイント。インタラクティブウィザードが 4 つの質問を聞き、自己完結したプロジェクトツリーを書き出す。

```bash
$ npx create-ampless@latest my-blog

create-ampless
│
◇ Project name … my-blog
◇ Site display name … My Blog
◇ Themes to install (space to toggle) … blog, minimal, landing, corporate, docs, dads
◇ Plugins (space to toggle) … seo
◇ Create project "my-blog"? … Yes

✔ Project scaffolded

Next steps:
  cd my-blog
  npx ampx sandbox       # 個人用 Amplify dev backend を立ち上げ
  pnpm dev               # Next.js を起動
```

ウィザードが集める情報（[`packages/create-ampless/src/prompts.ts`](../../packages/create-ampless/src/prompts.ts)）：

| プロンプト | 選択肢 |
|---|---|
| Project name | a-z、0-9、`-`、`_` |
| Site display name | フリーテキスト |
| Themes（複数選択） | `blog` / `minimal` / `landing` / `corporate` / `docs` / `dads` — 最初に選ばれたものがデフォルトの `theme.active` |
| Plugins（複数選択） | `seo` / `rss` / `webhook` |

認証方式を聞くプロンプトはない — どのプロジェクトも標準 Cognito の email + password を使う。プラグインも 3 つ以外の選択肢はなく（contact form なし、analytics なし）、追加は scaffold 後に `pnpm add @ampless/plugin-...` でやる。

### 非対話的スキャフォールド

CI / 自動化向けにすべての質問にフラグ等価が用意されている：

```bash
npx create-ampless@latest my-blog \
  --site-name "My Blog" \
  --themes blog,docs \
  --plugins seo,rss \
  --skip-confirm
```

### ローカル開発

```bash
cd my-blog
npx ampx sandbox       # AWS アカウントに個人用 Amplify backend を provisioning
pnpm dev               # Next.js を起動
```

Amplify sandbox は Cognito + AppSync + DynamoDB + S3 を個人のユーザスタックとして立ち上げる。`Ctrl+C` で取り壊し（`--once` で永続化）。sandbox スタックは ephemeral として扱うのが現実的 — スキーマ変更で API ごと作り直しになりテーブルがリセットされることがある。

### 本番デプロイ

経路は 2 つ。

#### 経路 A：ゼロから `--deploy`

`create-ampless --deploy` は scaffold したあと GitHub リポジトリと Amplify Hosting アプリを作成し、両者を接続して最初のデプロイをキックする — を 1 コマンドで完了させる。

```bash
npx create-ampless@latest my-blog --deploy \
  --github-owner my-org \
  --aws-region us-east-1 \
  --create-iam-role
```

オプションでカスタムドメイン接続（`--domain` / `--subdomain`）、既存の Amplify Hosting service role の再利用（`--iam-service-role`）、private GitHub リポジトリ（`--github-private`）にも対応。

#### 経路 B：既存プロジェクトを `--mount`

ローカルで scaffold して `npx ampx sandbox` で試した後、scaffold をスキップしてカレントディレクトリを新しい GitHub リポ + Amplify Hosting アプリに接続するだけにする：

```bash
cd my-blog
npx create-ampless@latest --mount \
  --github-owner my-org \
  --aws-region us-east-1
```

Mount モードは「先にローカルで遊んでから本番公開したい」向きの実用的な経路。

### アップグレード

ampless パッケージのバージョンを上げた後、テンプレート所有のファイル（管理ルート・内部シェル）を再生成するには：

```bash
cd my-blog
npx create-ampless@latest upgrade        # または --upgrade
```

upgrade コマンドは `AMPLESS_MANAGED_APP_PATHS`（管理ルートと内部ルートシェル）を同期し、`AMPLESS_RETIRED_PATHS` にある retired ファイルがあれば削除する。管理パスの外にあるユーザ所有ファイル（テーマ、`cms.config.ts`、`app/page.tsx` 等）は触らない。`--dry-run` で書き込みなしの差分プレビューが見られる。

### テーマカスタマイズの流れ

同梱テーマ（`blog`、`corporate`、…）は *managed* — `--upgrade` でテンプレートが更新されると上書きされる。アップグレードで自分の編集を失わずカスタマイズするには、`my-` プレフィックス付きディレクトリにコピーする：

```bash
npx create-ampless@latest copy-theme blog my-blog
```

`themes/my-blog/` 配下はユーザ所有扱いで、upgrade は触らない。詳しい流れはプロジェクトの `THEMES.md` を参照。

### 配布方式

1. **`npx create-ampless@latest`**（primary）：インタラクティブ scaffold + 任意のワンショットデプロイ。
2. **`--mount`**：すでに scaffold したプロジェクトを後から GitHub + Amplify Hosting に接続。
3. **CDK construct 経路**：既存の Amplify Gen 2 プロジェクトに `@ampless/backend` を追加し、`defineAmplessBackend` / `amplessSchemaModels` / `amplessAuthConfig` 等を直接 `amplify/backend.ts` に import する。テンプレートツリーに収まらないサイト向けの逃げ道。

### EmDash との比較

| 工程 | EmDash (Cloudflare) | ampless (Amplify) |
|------|--------------------|-------------------|
| 初期化 | `npm create emdash@latest` | `npx create-ampless@latest` |
| ローカル backend | `npx wrangler dev` | `npx ampx sandbox` |
| ローカル frontend | （同じプロセス） | `pnpm dev` |
| 本番デプロイ | `npx wrangler deploy` | `--deploy` / `--mount`（自動）、または Amplify コンソールで手動接続 |
| 必要アカウント | Cloudflare（無料枠あり） | AWS（無料枠あり） |
| 最大のハードル | wrangler の設定 | AWS アカウント + 初期 IAM セットアップ |

---
