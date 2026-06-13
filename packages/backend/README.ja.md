> English: [README.md](./README.md)
> 

# @ampless/backend

[ampless](https://github.com/heavymoons/ampless) 向け Amplify Gen 2 バックエンドファクトリー。IAM / SQS / DynamoDB ストリームの配線、認証 / データ / ストレージの定義、およびすべてのイベント処理 Lambda を `defineAmplessBackend(...)` ひとつのファクトリーにまとめます。

> **プレリリース / ベータ版。** v1.0 まではマイナーバージョンでも破壊的変更が入る可能性があります。

テンプレートから切り出すことで、スキャフォールダーを再実行せずに `npm update @ampless/backend` でアップデートできます。バックエンドのバグ修正やインフラ改善はパッケージ経由で届きます。ユーザー側の `amplify/` ツリーは、ファクトリーを組み合わせる 1〜5 行のシェルだけで済みます。

## インストール

```bash
npm install @ampless/backend@beta ampless@beta
```

ピア依存: `@aws-amplify/backend`（^1）、`aws-cdk-lib`（^2）。CLI スキャフォールダーがテンプレートの `package.json` に互換バージョンをピン留めします。

## 使い方

### `amplify/backend.ts`

```ts
import { defineAmplessBackend } from '@ampless/backend'
import { auth } from './auth/resource'
import { data } from './data/resource'
import { storage } from './storage/resource'
import { postConfirmation } from './auth/post-confirmation/resource'
import { eventDispatcher } from './events/dispatcher/resource'
import { processorTrusted } from './events/processor-trusted/resource'
import { processorUntrusted } from './events/processor-untrusted/resource'
import { apiKeyRenewer } from './functions/api-key-renewer/resource'

export default defineAmplessBackend({
  auth, data, storage, postConfirmation,
  eventDispatcher, processorTrusted, processorUntrusted, apiKeyRenewer,
})
```

### `amplify/auth/resource.ts`

```ts
import { defineAuth } from '@aws-amplify/backend'
import { amplessAuthConfig } from '@ampless/backend'
import { postConfirmation } from './post-confirmation/resource'

export const auth = defineAuth(amplessAuthConfig({ postConfirmation }))
```

> `defineAuth` は `amplify/auth/resource.ts` 自体に記述する必要があります。Amplify Gen 2 のインポートパス検証機能が `defineAuth` / `defineData` / `defineStorage` の呼び出し元を検査し、他のファイル（`node_modules/@ampless/backend/...` 配下のラッパーを含む）から呼び出された場合に `Amplify Auth must be defined in amplify/auth/resource.ts` というエラーを投げます。`amplessAuthConfig` は props オブジェクトを返すため、ampless のデフォルト設定を失わずにこのファイルで `defineAuth(...)` を呼び出せます。

#### パスキー（WebAuthn）

`amplessAuthConfig` はデフォルトでパスキーサインインを有効化します。オペレーターは管理画面のアカウントページからパスキーを登録すると、Face ID / Touch ID / セキュリティキーでサインインできます。パスワードフローは初回ブートストラップ兼フォールバックとして常に利用可能なまま残ります。

```ts
amplessAuthConfig({ postConfirmation })                       // パスキー有効・RP ID は自動解決
amplessAuthConfig({ postConfirmation, webAuthn: true })       // デフォルトと同じ
amplessAuthConfig({                                            // カスタムドメイン用に Relying Party ID を固定
  postConfirmation,
  webAuthn: { relyingPartyId: 'admin.example.com' },          // プロトコル・パスなしの bare domain
})
amplessAuthConfig({ postConfirmation, webAuthn: false })      // パスワードのみのサインイン
```

Amplify Hosting パイプラインビルドでは、テンプレートが `cms.config.ts` の `site.url` から `resolveWebAuthn({ override, siteUrl, isPipeline })` を通じて Relying Party ID を自動導出します。最も一般的なケースでは手動設定不要です。`ampx sandbox` では RP ID は `localhost` のまま（Amplify が自動解決）です。管理画面を `site.url` と**異なるサブドメイン**で配信している場合は、`amplify/auth/resource.custom.ts` でオペレーターがアクセスする bare domain を `relyingPartyId` に固定してください。パスキー登録後に RP ID を変更すると、登録済みの認証情報がすべて無効化されます。[docs/passkeys.ja.md](https://github.com/heavymoons/ampless/blob/main/docs/passkeys.ja.md) を参照してください。

### `amplify/data/resource.ts`

```ts
import { a, defineData, type ClientSchema } from '@aws-amplify/backend'
import { amplessSchemaModels, defaultAuthorizationModes } from '@ampless/backend'

const schema = a.schema({
  ...amplessSchemaModels(a),
  // カスタムモデルをここに追加 — 組み込みモデルと同居します：
  // MyCustomModel: a.model({ ... }).authorization((allow) => [...]),
})

export type Schema = ClientSchema<typeof schema>
export const data = defineData({ schema, authorizationModes: defaultAuthorizationModes })
```

3 つの AppSync JS リゾルバーファイル（`list-published-posts.js`、`get-published-post.js`、`list-posts-by-tag.js`）はテンプレート内に残ります — AppSync がリゾルバーの `entry` パスを CDK synth 時に `defineData` を呼び出すファイルからの相対パスで解決するため、pnpm でシンボリックリンクされた `node_modules` パスは解決を通過できません。`amplify/data/` 以外の場所に移動する場合は、`amplessSchemaModels(a, { resolverPaths })` で新しいパスを渡してください。

### `amplify/storage/resource.ts`

```ts
import { defineStorage } from '@aws-amplify/backend'
import { amplessStorageConfig } from '@ampless/backend'
export const storage = defineStorage(amplessStorageConfig())
```

> 認証と同じインポートパス制約があります — `defineStorage` はこのファイルから直接呼び出す必要があります。`amplessStorageConfig` は props オブジェクトを返します。

### Lambda 薄型シェル

`amplify/auth/`、`amplify/events/`、`amplify/functions/` 内の各ハンドラーファイルは 1〜3 行の re-export になります。Amplify の esbuild がこのパッケージへのインポートを追跡し、実際のハンドラーコードを Lambda アーティファクトにバンドルします。

```ts
// amplify/auth/post-confirmation/handler.ts
export { handler } from '@ampless/backend/auth/post-confirmation'

// amplify/events/dispatcher/handler.ts
export { handler } from '@ampless/backend/events/dispatcher'

// amplify/events/processor-trusted/handler.ts
import config from '../../../cms.config'
import { createProcessorTrustedHandler } from '@ampless/backend/events/processor-trusted'
export const handler = createProcessorTrustedHandler({
  plugins: config.plugins,
  site: config.site,
})

// amplify/events/processor-untrusted/handler.ts
import config from '../../../cms.config'
import { createProcessorUntrustedHandler } from '@ampless/backend/events/processor-untrusted'
export const handler = createProcessorUntrustedHandler({
  plugins: config.plugins,
  site: config.site,
})

// amplify/functions/api-key-renewer/handler.ts
export { handler } from '@ampless/backend/functions/api-key-renewer'
```

## サブパス

- `@ampless/backend` — `defineAmplessBackend`、`amplessAuthConfig`、`resolveWebAuthn`、`amplessStorageConfig`、`amplessSchemaModels`、`extendAmplessSchema`、`defaultAuthorizationModes`
- `@ampless/backend/auth/post-confirmation` — Lambda ハンドラー
- `@ampless/backend/events/dispatcher` — Lambda ハンドラー
- `@ampless/backend/events/processor-trusted` — `createProcessorTrustedHandler({ plugins, site })`
- `@ampless/backend/events/processor-untrusted` — `createProcessorUntrustedHandler({ plugins, site })`
- `@ampless/backend/functions/api-key-renewer` — Lambda ハンドラー

## テンプレートに残るもの

- `amplify/data/*.js` — AppSync JS リゾルバー（ファイルパス制約のため）。
- すべての `resource.ts` と `handler.ts` — 薄型シェルですが、Amplify の CDK synth がユーザー側で解決する `entry: './handler.ts'` パスを保持しています。
- `cms.config.ts` と `themes-registry.ts` — ユーザーが所有するカスタマイズサーフェス。
- `templates/<theme>/` 以下のテーマコンポーネント — ユーザーが所有。

## ライセンス

MIT
