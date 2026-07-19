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
1. `npx create-ampless@beta` でプロジェクト生成
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
  mcp-server/         — ツールレジストリ + 共有 JSON-RPC dispatch + 公開ツール（npm に公開）
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

`@ampless/mcp-server` は **npm に公開されている**（public access）。`@ampless/admin` / `@ampless/backend` / `@ampless/runtime` 経由で推移的に入るため、直接インストールは不要。3 つのサブパスエントリを公開する：

| サブパス | 内容 |
|---|---|
| `@ampless/mcp-server/tools` | admin ツールレジストリ（`tools` / `getTools` / `dispatchToolCall` / `ToolDefinition`） |
| `@ampless/mcp-server/jsonrpc` | トランスポート非依存の JSON-RPC 2.0 dispatch（`dispatchJsonRpc`）。admin（backend）と公開（runtime）の両 MCP エンドポイントで共有 — protocolVersion ネゴシエーション、`tools/list` annotations、notification 処理 |
| `@ampless/mcp-server/public` | 読み取り専用の公開ツール（`publicTools`）+ runtime が注入する `PublicToolContext` |

レジストリはトランスポートを知らない — 各トランスポートが context（admin: GraphQL + S3 の `ToolContext`、公開: `PublicToolContext`）を注入し、共有の `dispatchJsonRpc` に流す。

```typescript
import { tools } from '@ampless/mcp-server/tools'
import { dispatchJsonRpc } from '@ampless/mcp-server/jsonrpc'
import { publicTools } from '@ampless/mcp-server/public'
```

##### JSON-RPC プロトコル挙動（共有）

両エンドポイントは同じ `dispatchJsonRpc` を通る：

- **`initialize` のバージョンネゴシエーション**: サポート版は `2025-03-26`（tool annotations を定義した最初の版）と `2024-11-05`。サポート内の要求版はそのまま返し、サポート外の*文字列*なら `2025-03-26` に落とす。`protocolVersion` の**欠落または非文字列**（number / null / object）は `INVALID_PARAMS` エラー。`2025-06-18` は意図的に名乗らない（stateless な JSON-POST エンドポイントが実装しないトランスポート要件を伴うため）。
- **`tools/list` annotations**: 各ツールに `{ readOnlyHint, destructiveHint }` を付与。単一フラグからの導出ではなく明示分類（read / 追加 write / 上書き write / destructive）— 既存状態を上書きする update 系は `destructiveHint: true`。
- **request id**: 有効な `id` は文字列または整数。`id: null`（MCP で禁止）と小数の数値 id は `INVALID_REQUEST` で拒否する — `id` が*無い*場合（notification）とは区別される。
- **notification**（`id` を持たない JSON-RPC リクエスト、例 `notifications/initialized`）は*どの* method でも本文を返さない — method 自体は実行される（`tools/call` の handler も含む）がレスポンスは抑止され、admin HTTP ハンドラは `202 Accepted` にマップする。

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

#### 公開読み取り専用 MCP ([`@ampless/mcp-server/public`](../../packages/mcp-server/src/public))

トークン不要の **匿名・読み取り専用** MCP surface が、公開済みコンテンツを AI クライアントに提供する。Next.js runtime の `/api/mcp` ルート（`createPublicMcpRouteHandler`、`app/api/mcp/route.ts` にマウント）から配信され、同じ共有 dispatch を、runtime が apiKey モードの `listPublishedPosts` / `getPublishedPost`（draft はサーバ側で除去）+ `postToMarkdown` で backing した `PublicToolContext` とともに通す。

**オプトイン。** `cms.config.ai.publicMcp === true` でない限りルートは 404 を返す — 無認証のため既定は無効。`POST` / `OPTIONS` の両方が gate される。

| ツール | 説明 |
|---|---|
| `list_posts` | 新しい順の公開投稿サマリー 1 ページ + 不透明な `nextCursor`（単一ページ read、走査なし） |
| `get_post` | slug で公開投稿 1 件、本文を `markdown` にレンダリング。10 万字超は切り詰め（`truncated: true`） |
| `search_posts` | 直近投稿の有界走査に対する title / slug / tags / excerpt への大小無視部分一致（`scanTruncated` で走査打ち切りを通知） |
| `list_tags` | 同じ有界走査でタグ出現数を集計（降順） |

設計上の制約：

- **公開済みのみ。** 全ツールが公開インデックス resolver を通す。draft には到達不能。
- **フィールド allowlist。** サマリーは `slug` / `title` / `excerpt` / `tags` / `publishedAt` / `updatedAt` / `format` のみ。`postId` / `status` / `metadata` / 生 `body` は決して出力しない（`Post` の spread ではなく明示的な pick）。
- **有界走査。** `search_posts` / `list_tags` は最大 5 AppSync ページ（≈直近 200 件）まで。匿名の body 込み read は CDN で吸収できないため、ツール層で件数・ページ数を有界化する。リクエスト頻度制限は route の責務。
- 4 ツールとも `readOnlyHint: true, destructiveHint: false` を annotation で持つ。
- **明示的なクライアント安全エラー。** validation failure と想定内の not-found は `ToolUserError` を throw し、共有 dispatcher はその message をログせずクライアントへ返せる。独立 bundle の `./jsonrpc` と `./public` でも同じ印として認識できるよう、class は `Symbol.for` brand を使う。それ以外の例外 — 名前だけ `ToolUserError` にした未 brand の error を含む — はログに残し、公開 transport がマスクする。`ToolUserError` の message に secret、内部詳細、未処理のユーザ入力を含めてはならない。

トランスポート / HTTP framing（`createPublicMcpRouteHandler`）：

- **POST JSON-RPC 2.0**。admin トランスポートと `dispatchJsonRpcMessage` を共有するため、エンベロープ検証・非オブジェクト拒否・**batch** 処理（逐次・順序維持・batch 内 `initialize` 禁止・≤`MAX_BATCH` = 50）は両エンドポイントで同一。タグ付き結果を HTTP にマップ：`invalid` → 400、`ok` → 200、`no-content`（notification のみ）→ 202。
- 全レスポンスに **open CORS**（`Access-Control-Allow-Origin: *`、`POST, OPTIONS`）。有効時の `OPTIONS` preflight は 204。匿名・読み取り専用・公開済みのみ・credential 不使用なので安全。
- **64KB ボディ上限。** `Content-Length` が上限超なら読み取り前に 413。chunked body は上限を跨いだ時点でストリーム中断（全量バッファリングしない）。
- **粗い circuit breaker（per-IP rate limit ではない）。** module スコープの固定ウィンドウカウンタ 1 個（600 req/min、batch は要素 1 つにつき 1 消費）で、1 warm lambda instance が暴走リクエストに張り付くのを止める。`x-forwarded-for` で **キーしない** — CloudFront はクライアント送信の XFF を保持し実 IP を末尾に追記するため先頭値は偽装可能・hop 数も不定。warm instance 内でしか効かず、真の per-IP throttle / DoS 対策は CloudFront / WAF の責務。予期しないツール失敗は `console.error` に記録しつつ固定文言でマスクし、匿名 endpoint が内部詳細を漏らさないようにする。
- **最外周ガード。** ストリーム読取失敗や予期しない例外でも、Next.js 素の HTML 500 ではなく CORS つき JSON-RPC 500（`id: null`）を返す。

公開 MCP が有効な場合、接続案内は 3 か所に出る。`/llms.txt` は machine reader 向けに読み取り専用 endpoint と tool 名を掲載し、管理画面の MCP トークンページは token 認証の admin endpoint と分けて解決済み公開 endpoint を表示し、[docs/mcp.ja.md](../mcp.ja.md) が人間向けの接続ガイド（Claude Code / Cursor / VS Code の設定 + MCP Registry への公開手順）になる。読者向けのページ上リンク / QR コードは、下記の標準的な machine discovery を優先して取りやめた。

#### MCP Discovery（experimental — `ai.mcpDiscovery`）

opt-in の experimental な discovery surface により、AI クライアントは URL を手渡されなくても公開 endpoint を発見できる。`ai.publicMcp` に**加えて** `ai.mcpDiscovery`（デフォルト無効）でゲートされ、さらに `http(s)` の `site.url` を必須とする — いずれかのフラグが無効、または URL が解決できない場合、routes は 404 を返す。プロトタイプの `modelcontextprotocol/experimental-ext-server-card` 仕様（SEP-2127、まだ open / unmerged）に準拠しており、schema とパスは upstream の変化に追随して変わり得る。

2 つのドキュメントを配信する（`createMcpDiscoveryRouteHandlers`、`packages/runtime/src/routes/mcp-discovery.ts`）:

- **Catalog** — `GET /.well-known/mcp/catalog.json`。App Router は `.` で始まるフォルダをきれいにホストできず（生のネストした dotfile は npm の packing 仕様の癖も踏む）、middleware が `/.well-known/mcp/catalog.json` を dot なしの内部 `/api/mcp/catalog.json` へ rewrite する（rewrite は両フラグが有効なときのみ発火。`.well-known` はそれ以外は予約済みの passthrough prefix なので、他の `/.well-known/*` パス — 例えば operator が置く `/.well-known/mcp-registry-auth` — はそのまま Next に到達する）。catalog は Server Card を指す 1 エントリ（`urn:air:<hostname>:ampless-mcp`）を持つ。
- **Server Card** — `GET /api/mcp/server-card`（仕様が推奨する `<streamable-http-url>/server-card` の配置で rewrite 不要）。identity（`site.url` から導出した reverse-DNS の `name`、`version`）、`websiteUrl`、`remotes[]`（`/api/mcp` endpoint + `supportedProtocolVersions`）を宣言する。tool は列挙**しない** — それは runtime の `tools/list` 呼び出しのまま。`Content-Type: application/mcp-server-card+json`。

両レスポンスとも open CORS（`GET, OPTIONS`）と `Cache-Control: public, max-age=3600` を持つ。Card は upstream schema の vendored コピーに対してテストで検証される（`Ajv2020` + `ajv-formats`、negative control つき）。

仕様は Card が広告する identity が稼働中の server と一致していることを要求する。そのため `mcpDiscovery` が有効なとき、`/api/mcp` の `initialize` `serverInfo` は静的な `{ name: 'ampless-mcp', version: '0.2' }` から、Card と同じ site 由来の reverse-DNS identity（`{ name: '<reverse-dns>/ampless-mcp', version: '0.2.0' }`）に切り替わる。これは discovery が JSON-RPC endpoint に持ち込む**唯一**の wire 変更 — tool の挙動、error shape、レスポンス構造は変わらず、デフォルト無効のサイトは追加の設定 fetch なしで静的な serverInfo を保つ。

MCP Registry（`server.json`）はコードではなくドキュメントで扱う: 登録には ampless が代行できない operator 所有の namespace 証明（DNS TXT / HTTP / GitHub OAuth）が必要で、`mcp-publisher init` がすでに `server.json` を scaffold する。公開手順は [docs/mcp.ja.md](../mcp.ja.md) を参照。

### 方針

- 管理 UI、公開サイト、MCP Lambda は**同じ** AppSync スキーマを読み書きする。違うのは認証モードだけ。
- MCP トランスポートは HTTP 専用。
- ファーストクラスの REST API はスコープ外。MCP 以外のマシン向けエンドポイントが必要なら AppSync を直接叩く。

---
