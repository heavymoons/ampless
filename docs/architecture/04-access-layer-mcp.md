## 4. アクセス層とMCP

### 設計思想

コンテンツへのアクセス経路は複数あるが、ビジネスロジックは Core ライブラリに集約する。
各インターフェースは Core を呼ぶだけの薄いアダプタとする。

```
管理画面 (Next.js)  ─┐
REST / GraphQL API  ─┤─→  Core (packages/ampless)  ─→  DynamoDB / S3
MCP Server          ─┘
```

### Core ライブラリ (`packages/ampless`)

すべての CRUD 操作、権限チェック、フォーマット変換を提供する。

```typescript
// packages/ampless/src/core.ts
interface AuthContext {
  userId: string
  role: 'reader' | 'editor' | 'admin'
  source: 'cognito' | 'api-key' | 'mcp'
}

// すべての操作が AuthContext を受け取る
function getPost(auth: AuthContext, siteId: string, postId: string) { ... }
function updatePost(auth: AuthContext, siteId: string, postId: string, data: ...) { ... }
function listPosts(auth: AuthContext, siteId: string, options?: ListOptions) { ... }
```

### 認証

Cognito のパスワードレス認証をデフォルトとする。

#### ログインフロー

```
メールアドレス入力 → Cognito がワンタイムコード送信 → コード入力 → ログイン完了
```

- パスワード管理不要。セキュリティリスクを下げる
- Cognito の `CUSTOM_AUTH` フロー + Lambda トリガーで実装
- 将来的にパスキー対応も検討可能

#### Amplify Auth 設定

```typescript
// amplify/auth/resource.ts
export const auth = defineAuth({
  loginWith: { email: true },
  groups: ['ampless-admin', 'ampless-editor', 'ampless-reader'],
  triggers: {
    postConfirmation: defineFunction({ name: 'post-confirmation' }),
  },
})
```

Cognito ユーザーグループは `groups` に定義するだけで自動作成される。

#### 初期セットアップ

```
1. npx create-ampless@latest でプロジェクト生成
2. デプロイ後、初回アクセス時にセットアップ画面を表示
3. 管理者のメールアドレスを入力
4. ワンタイムコードで認証 → 最初のユーザーが自動的に admin グループに所属
5. 以降のユーザーは admin が招待しない限り管理画面にアクセスできない
```

最初のユーザーの admin 自動登録は Post Confirmation Lambda トリガーで実装:

```typescript
// amplify/auth/post-confirmation.ts
export async function handler(event) {
  const cognito = new CognitoIdentityProviderClient({})

  // admin グループが空 = 最初のユーザー → admin に追加
  const group = await cognito.send(new ListUsersInGroupCommand({
    UserPoolId: event.userPoolId,
    GroupName: 'ampless-admin',
  }))

  if (group.Users.length === 0) {
    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: event.userPoolId,
      Username: event.userName,
      GroupName: 'ampless-admin',
    }))
  }

  return event
}
```

#### ユーザー管理

管理画面のユーザー管理ページから Cognito の Admin API を直接操作する。
自前のユーザーテーブルは持たない。

| 操作 | 誰ができるか | Cognito API |
|------|------------|-------------|
| 初期 admin 登録 | 最初のセットアップ時のみ | Post Confirmation トリガー |
| ユーザー招待 | admin | `AdminCreateUser`（招待メール自動送信） |
| role 付与・変更 | admin | `AdminAddUserToGroup` / `AdminRemoveUserFromGroup` |
| ユーザー一覧 | admin | `ListUsers` |
| ユーザー削除 | admin | `AdminDeleteUser` |
| 自分のログイン | 招待済みユーザー | 通常の認証フロー |

Cognito の Admin API は IAM で保護されており、ブラウザから直接は叩けない。
Server Actions / API Route 経由でのみアクセスする。

#### セキュリティ対策

管理画面の全操作（Server Actions / API Route）で認証・認可チェックを必須とする。

```typescript
// 全 Server Action の先頭で実行
async function requireAdmin() {
  const session = await getServerSession()
  if (!session) throw new Error('Unauthorized')
  if (!session.groups.includes('ampless-admin')) throw new Error('Forbidden')
  return session
}
```

| リスク | 対策 |
|--------|------|
| 未認証ユーザーがアクセス | 全 Server Action で認証チェック |
| editor が admin 操作を実行 | role チェック |
| 自分で自分を admin 昇格 | Cognito グループ変更は admin のみ |
| 最後の admin を削除 | admin グループが空になる操作をブロック |

#### Cognito ユーザーグループ

| Cognito グループ | role | 説明 |
|-----------------|------|------|
| `ampless-admin` | admin | 全権限。ユーザー管理、サイト設定、プラグイン管理 |
| `ampless-editor` | editor | コンテンツの作成・編集・削除 |
| `ampless-reader` | reader | 公開コンテンツの読み取り（API 利用者向け） |

### 権限モデル

| role | できること |
|------|----------|
| `reader` | 公開コンテンツの読み取り |
| `editor` | コンテンツの作成・編集・削除 |
| `admin` | サイト設定、プラグイン管理、ユーザー管理 |

認証ソースに関わらず、role ベースで統一的に制御する。

| ソース | 認証方法 | role の決定 |
|--------|---------|------------|
| 管理画面 | Cognito ワンタイムコード | Cognito ユーザーグループから |
| REST API | API キー | キー発行時に設定 |
| MCP | MCP アクセストークン | トークン発行時に設定 |

### MCP Server (`packages/mcp-server`)

AI エージェント（Claude 等）からコンテンツを操作するための MCP インターフェース。

```
packages/
  ampless/        ← Core（共通ビジネスロジック）
  mcp-server/     ← MCP アダプタ（Core に依存）
```

#### MCP Tools（予定）

| Tool | role | 説明 |
|------|------|------|
| `list_posts` | reader | 記事一覧の取得 |
| `get_post` | reader | 記事の取得（format 指定可） |
| `create_post` | editor | 記事の作成 |
| `update_post` | editor | 記事の更新 |
| `delete_post` | editor | 記事の削除 |
| `upload_media` | editor | メディアファイルのアップロード |
| `get_schema` | reader | コンテンツスキーマの取得 |
| `manage_site` | admin | サイト設定の変更 |
| `manage_plugins` | admin | プラグインのインストール・設定 |

#### MCP と trust_level の関係

MCP Server 自体は ampless Core を直接呼ぶため、プラグインの trust_level とは独立。
MCP のアクセストークンに紐づく role で権限を制御する。

### v1 方針
- 管理画面と MCP Server は同じ Core ライブラリを使う
- REST API は v0.2 以降で追加
- MCP Server は v0.1 から提供（AI ファーストの差別化ポイント）

---
