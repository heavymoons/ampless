> English: [04-access-layer-mcp.md](./04-access-layer-mcp.md)
> 
## 4. アクセスレイヤと MCP

### 設計方針

永続化は DynamoDB + S3 で、その手前に AppSync GraphQL を 1 本だけ置く。クライアント（管理画面 / MCP HTTP ハンドラ / 公開サイト）はすべてこの AppSync エンドポイントに向かって、それぞれ別の認証モードで接続する。CRUD を担う独立サービスは存在しない。

```
管理画面 (Next.js)    → AppSync (Cognito User Pool, admin/editor グループ) →┐
MCP Lambda (HTTP)     → AppSync (IAM / SigV4、resource auth 経由)             ├→ DynamoDB / S3
公開サイト / テーマ    → AppSync (apiKey, カスタムリゾルバが draft を除外)    ─┘
```

`ampless` パッケージ自体は CRUD ロジックを持たない。型定義、テーマ / プラグイン契約、フォーマット変換ヘルパー、そして管理画面 / ランタイムが Amplify Data クライアントとテストフィクスチャを差し替えできるよう小さな `PostsProvider` インターフェース ([`packages/ampless/src/core.ts`](../../packages/ampless/src/core.ts)) のみを公開している。

### 認証

標準の Cognito **email + password** 認証（SRP）。Amplify Auth ([`packages/backend/src/auth/index.ts`](../../packages/backend/src/auth/index.ts)) でフローを組み立てているだけで、カスタム認証フローは使っていない。

```typescript
// @ampless/backend → amplify/auth/resource.ts 経由で解決
defineAuth({
  loginWith: { email: true },
  groups: ['ampless-admin', 'ampless-editor', 'ampless-reader'],
  triggers: {
    postConfirmation: defineFunction({ /* 最初のユーザを admin に昇格 */ }),
  },
})
```

ログイン UI ([`packages/admin/src/components/login-view.tsx`](../../packages/admin/src/components/login-view.tsx)) は Cognito の標準モードをカバー：

| モード | 用途 |
|---|---|
| `signIn` | email + password でログイン |
| `signUp` | 新規アカウント作成 → 確認コード送信 |
| `confirm` | 受信した確認コードを入力してメール確認 |
| `forgot` | パスワード再設定メールを送信 |
| `reset` | 受信したコードで新パスワードを設定 |

magic link や WebAuthn などのパスワードレスは現状使っていない。後で採用する場合も `defineAuth` の設定変更だけで済むため、設計の作り直しは不要。

#### Cognito ユーザーグループ

3 つのグループを宣言。管理 UI が「ロール」として扱うのは最初の 2 つだけで、`ampless-reader` は admin/editor に昇格していないアカウントの暗黙的な状態。

| グループ | 説明 |
|---|---|
| `ampless-admin` | 全権限：ユーザ管理、サイト設定、プラグイン管理、MCP トークン発行 |
| `ampless-editor` | コンテンツの作成・編集・削除。**信頼された主体**として扱う（後述） |
| `ampless-reader` | 未昇格アカウントのデフォルト。管理 UI へのアクセス権はなく、公開サイトは API キー経由で読むため、現状は将来用のプレースホルダ |

#### 初期セットアップ

```
1. `npx create-ampless@latest` でプロジェクト生成
2. `npx ampx sandbox`（開発）か Amplify Hosting（本番）でデプロイ
3. 管理画面のログイン画面で sign up → Cognito が確認コードをメール送信
4. コードを入力。post-confirmation トリガが admin グループが空かを確認し、
   空ならこのユーザを `ampless-admin` に昇格させる
5. 以降の sign up は reader 状態でランディングし、admin が手動で昇格する必要がある
```

post-confirmation トリガ ([`packages/backend/src/auth/post-confirmation.ts`](../../packages/backend/src/auth/post-confirmation.ts)) は**最初の 1 人だけ**を admin に昇格させ、それ以降の管理は admin の手作業に任せる。

#### ユーザー管理

管理画面 → Users で Cognito ユーザを一覧し、admin がユーザのロールを `admin` / `editor` / `none` の間で切り替える。ページは AppSync の `listAdminUsers` / `setAdminUserRole` を呼び、これらは user-admin Lambda ([`packages/backend/src/auth/user-admin.ts`](../../packages/backend/src/auth/user-admin.ts)) にバインドされる。Lambda は Cognito の Admin API（`ListUsers` / `AdminAddUserToGroup` / `AdminRemoveUserFromGroup`）を直接呼ぶので、独自のユーザテーブルは保持しない。

| 操作 | 主体 | 仕組み |
|---|---|---|
| 初期 admin の自動付与 | 初期セットアップのみ | post-confirmation トリガ |
| サインアップ | 任意（または invite された人） | Cognito sign-up + メール確認 |
| ロール変更 | admin | `setAdminUserRole` → Cognito の `AdminAddUserToGroup` / `AdminRemoveUserFromGroup` |
| ユーザ一覧 | admin | `listAdminUsers` → Cognito の `ListUsers` |
| 自己昇格 | （ブロック） | `listAdminUsers` / `setAdminUserRole` の GraphQL op が `ampless-admin` 必須 |

#### 権限境界

サーバ側の書き込みは必ず Cognito グループ認可（admin / editor）か、MCP Lambda の IAM ロールのいずれかを通る。AppSync の認可を迂回するパスはない。

| ソース | 認証モード | 実効ロール |
|---|---|---|
| 管理 UI | Cognito User Pool | `cognito:groups`（`admin` または `editor`） |
| 公開サイト / テーマコンポーネント | AppSync API キー | 読み取り専用。`listPublishedPosts` / `getPublishedPost` / `listPostsByTag` のカスタムリゾルバのみ（draft は除外） |
| MCP HTTP ハンドラ | IAM SigV4（`allow.resource(mcpHandler)`） | resource grant の範囲では admin 相当 |

#### editor の信頼モデル（仕様）

ampless は `editor` を**信頼された主体**として扱う。WordPress の `unfiltered_html` capability と同じ思想で、**editor は投稿本文に任意の HTML / JavaScript を保存できる** — これは明示的な設計判断。

具体的には：

- Post の `body` フィールドはサーバサイドでサニタイズしない
  - `format: 'tiptap' | 'markdown' | 'html'` のいずれもサニタイズなし
  - tiptap の属性（`href`、`src`、`alt`、`title` 等）もサニタイズなし
  - `<script>` タグ、`javascript:` URI、属性のブレイクアウトによる event handler 注入は、いずれもそのまま保存され、サーバサイドレンダラ ([`packages/runtime/src/rendering.ts`](../../packages/runtime/src/rendering.ts)) で HTML として描画される
- 結果として editor は**公開投稿を閲覧している任意のブラウザ（管理者ブラウザを含む）で任意の JavaScript を実行できる**
- これは「editor を CRUD 専用に縛らず、埋め込みウィジェット・カスタムスクリプト付きキャンペーンページ・HTML メールテンプレ等の表現自由度を優先する」ための意図的な選択

**運用上の含意：**

- **editor 権限は admin と同等の信頼が置ける人にだけ付与する。** 信用しきれないユーザは reader 状態のままにするか、別の Cognito User Pool（別の Amplify デプロイ）に隔離する。
- editor が悪意を持って動いた場合の権限上界は admin 相当。公開投稿経由で admin の Cognito JWT を localStorage から窃取し、AppSync を admin として叩ける。
- このトレードオフを変えたい運用向けには、**opt-in のサニタイズプラグイン**（DOMPurify ベース）を計画中。スキーマを変えずに `before:content.update` フックで本文を書き換える方式で、WordPress 的な editor サンドボックスを再現する。

**セキュリティレビューでの扱い：**

editor を脅威モデルに含む指摘（stored XSS による editor → admin 昇格、JWT 漏洩、`format: 'html'` 経由の任意 `<script>` 等）は**仕様であって脆弱性ではない**。レビューでは明示的に除外し、実際の脆弱性として扱うのは：

- 未認証主体が editor 相当の書き込みを行えるパス
- サーバ側エラーで書き込み整合性が壊れるもの（DynamoDB トランザクション破綻、非正規化 GSI キーのレース起因の破損、dispatcher が DLQ なしでイベントを取りこぼす等）
- admin / operator を介さない RCE、シークレット漏洩、IAM 権限昇格

### MCP サーバ — トランスポートとツールレジストリ

MCP は **HTTP 専用**。構成は 2 パッケージに分かれる：

```
packages/
  mcp-server/         — ツールレジストリ（private、Lambda にバンドル）
  backend/
    src/functions/
      mcp-handler.ts          — Lambda エントリ。HTTP + JSON-RPC + Bearer 認証
      mcp-graphql-client.ts   — ツール用 AppSync クライアント（SigV4）
      mcp-storage-client.ts   — ツール用 S3 クライアント
      mcp-static-bundle.ts    — バンドル系ツールが共有する zip 展開
```

#### HTTP トランスポート ([`packages/backend/src/functions/mcp-handler.ts`](../../packages/backend/src/functions/mcp-handler.ts))

Lambda Function URL + Bearer トークン認証。ワイヤフォーマットは JSON-RPC 2.0。`initialize` / `tools/list` / `tools/call` の 3 動詞だけを自前でハンドリングする（Lambda 環境で MCP SDK を起動するのは過剰）。

```
MCP クライアント → Lambda Function URL に HTTPS POST
               Authorization: Bearer amk_<base64url>
                 └── SHA-256 ハッシュ → McpToken テーブルを GetItem（admin-only モデル）
                       └── 不一致 / 失効 / 期限切れは reject
                             └── dispatchToolCall (@ampless/mcp-server/tools)
                                   ├── AppSync を SigV4 (IAM) で叩く
                                   └── S3 を Lambda 実行ロールで叩く
```

- **トークン形式：** `amk_` プレフィックス + base64url エンコードされた乱数。
- **保管：** 平文トークンの SHA-256 hex のみを保存。検証は `McpToken` テーブルへの `GetItem` 1 回で済み、認証パスで AppSync を経由しない。
- **発行：** 管理画面 `/admin/mcp-tokens` から。McpToken モデルは admin-only なので editor は発行できない。
- **実効認可：** トークン自体にロールは載っていない。Lambda の IAM ロールがセキュリティ境界。スキーマの `allow.resource(mcpHandler).to(['query', 'mutate'])` は **schema scope に付与され、モデル単位ではない**。したがって AppSync スキーマに宣言された全モデルが MCP Lambda の IAM principal から到達可能になる。現時点での具体的な到達範囲:
   - 組み込み CMS モデル（Post / Page / PostTag / Media / Taxonomy / KvStore）
   - `McpToken`（トークン発行・失効メタデータ）
   - `PluginSecret` / `PluginSecretIndicator`（Phase 6a の secret 保管テーブル — model-level の Cognito group sentinel は MCP Lambda を block しない。理由は下記の前例ノートに）
   - テンプレートの [`amplify/data/resource.ts`](../../templates/_shared/amplify/data/resource.ts) で `customSchemaModels(a)` 経由で追加されたカスタムモデル
   - 今後 [`packages/backend/src/data/index.ts`](../../packages/backend/src/data/index.ts) の `amplessSchemaModels` に追加される全モデル

   schema 全体 grant は意図的: `@aws-amplify/data-schema` は `allow.resource(...)` を schema scope でしか honor しない（model-level callback では `resource` が `allow` から strip される）ため、モデル単位の resource auth は Amplify Gen 2 では構造的に不可能。

   現状の MCP ツールレジストリは raw GraphQL を露出しておらず、McpToken / PluginSecret / PluginSecretIndicator に触れるツールも含んでいないため、トークン保持者がこれらのモデルに到達する運用上のパスは存在しない。ただし IAM grant はレジストリより広い — もし将来 `client.models.PluginSecret.list(...)` 系を wrap した MCP ツールが追加されれば、現状の grant のままで AppSync リクエストが成功する。したがって **MCP トークンを所持していること = AppSync スキーマ全体（現在および将来追加されるものを含む）に対する admin 相当の IAM アクセス**。発行は慎重に。sensitive model に触れる新規 MCP ツールの追加は明示的な scope 拡張として扱うこと。

   AppSync スキーマに新規 sensitive モデルを追加するときは、MCP Lambda が到達してよいか必ず明示的に判断する。次の 2 つのパスを取る:
   - そのモデルの persistence を AppSync から完全に外す（Lambda の DDB SDK + IAM grant + AppSync auth は「誰も所属しない placeholder Cognito group」に設定。Phase 6a の `PluginSecret` で採用したパターン）。
   - `amplessSchemaModels` の差分を allowlist と突き合わせて新規モデルでビルド失敗させる CI ガードを追加する（docs/threat model 更新を強制）。

   ##### 前例：`PluginSecret` の placeholder-group パターン (Phase 6a)

   `PluginSecret` は model-level の auth rule として `allow.groups(['__ampless_internal__'])` だけを宣言している。このグループに属する Cognito ユーザは存在しないので、admin/editor のブラウザセッションから AppSync 経由でこのモデルへ到達するパスは塞がれている — この防御は実体があり、本ドキュメントや source コメントで使われている「Cognito-group sentinel」の表現はこのレイヤを指している。

   しかし model-level rule が制限するのは **Cognito user pool auth mode のみ**。schema-level の `allow.resource(mcpHandler).to(['query', 'mutate'])` は独立した **IAM (SigV4) auth mode** で評価されるため、MCP Lambda（および AppSync の caller の中で MCP Lambda *だけ*）は SigV4 経由で今でも `PluginSecret` を read / write できる。プレーンテキストが漏れていないのは構造的な保証ではなく運用上の状況: MCP ツールレジストリに `read_plugin_secret` 的なツールが存在しないだけ。plugin-secret-handler Lambda は AppSync を完全に bypass している（直接 DDB SDK + 構築物への `grantReadWriteData` IAM）ので、仮に AppSync 経路を塞いでも secret 系の通常パスは動く — これは独立した設計要素。

   したがって新規 sensitive モデルに対する正確な表現は次の通り: 「Cognito user-pool auth は placeholder group で deny されている。AppSync IAM auth（および MCP Lambda）は、ツールレジストリがそのモデルを surface しない選択をしている限りで deny されている」。将来 MCP ツールがそのモデルを使う PR が出れば暗黙的にこの判断を再評価する必要がある。構造的な fix は上の CI ガードであって、placeholder-group パターン単体ではない。
- **ペイロード上限：** Function URL の呼び出しサイズ上限は base64 展開後で約 6 MB。大きな静的バンドルは差分系ツール（`upload_static_file` / `commit_static_post`）に分割する。

#### ツールレジストリ ([`packages/mcp-server`](../../packages/mcp-server))

`@ampless/mcp-server` は **internal library**（`private: true`、npm 公開なし）。ツール定義のレジストリと `dispatchToolCall(name, args, ctx)` を公開する。Lambda 側が `ToolContext`（GraphQL クライアント、S3 クライアント、site context）を注入する設計なので、レジストリはトランスポートを知らない。

```typescript
import { tools, dispatchToolCall } from '@ampless/mcp-server/tools'
```

#### MCP ツール

現行レジストリは 14 個のツールを提供 ([`packages/mcp-server/src/tools/index.ts`](../../packages/mcp-server/src/tools/index.ts))：

| ツール | 説明 |
|---|---|
| `list_posts` | ステータスフィルタとページネーション付きで投稿一覧 |
| `get_post` | slug / postId で 1 件取得 |
| `create_post` | 投稿を新規作成（`format` ∈ tiptap / markdown / html、`static` は拒否） |
| `update_post` | 投稿を更新 |
| `delete_post` | 投稿を削除し、`PostTag` 行もクリーンアップ |
| `upload_media` | base64 バイト列を `public/media/YYYY/MM/` にアップロードして Media レコードを作成 |
| `list_media` | Media 行を一覧。`mimeType`（前方一致）/ `prefix` / `createdAfter` / `createdBefore` フィルタとページネーション対応。各行は公開 `url` を含む |
| `search_media` | ファイル名 / `src` / `mimeType` への部分一致検索（上限までページを内部巡回） |
| `delete_media` | Media ファイル（S3 オブジェクト + 行）を `mediaId` または `src` で削除。`dryRun: true` で削除せずプレビュー |
| `get_schema` | CMS のコンテンツスキーマ（`static` 投稿の注記つき）を返す |
| `upload_static_bundle` | zip 1 発で送る形のバンドルアップロード。展開・検証・S3 プレフィックス置換・manifest 上書きを atomic に |
| `upload_static_file` | `public/static/<slug>/` 配下に 1 ファイルずつ差分アップロード |
| `delete_static_file` | `public/static/<slug>/` 配下のファイルを差分削除 |
| `commit_static_post` | S3 プレフィックスを再スキャンして Post の manifest を再構築（差分編集後の "save" ステップ） |

`create_post` / `update_post` は `format=static` を**意図的に拒否**して manifest と S3 のズレを防ぎ、static 系のエントリポイントはバンドル系ツールに一本化している。

### 方針

- 管理 UI、公開サイト、MCP Lambda は**同じ** AppSync スキーマを読み書きする。違うのは認証モードだけ。
- MCP トランスポートは HTTP 専用。
- ファーストクラスの REST API はスコープ外。MCP 以外のマシン向けエンドポイントが必要なら AppSync を直接叩く。

---
