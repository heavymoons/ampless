# パスキーサインイン（WebAuthn）

> English: [passkeys.md](./passkeys.md)

ampless は管理画面のパスキーサインインに対応しています。初回はパスワードでログインし、オペレーターがパスキーを登録すると、以降は Face ID / Touch ID / Windows Hello / ハードウェアセキュリティキーでサインインできます。パスワードを入力したり覚えたりする必要はありません。新規サイトではパスキーは**デフォルトで有効**で、パスワードフローは初回ブートストラップ兼フォールバックとして常に利用可能なまま残ります。

パスキーは Amplify Gen 2（CDK / CloudFormation）スタック内で完結してプロビジョニングされます。AWS コンソールでの操作も SES の設定も不要です。Cognito 組み込みの WebAuthn サポート（デフォルトの Essentials tier）を使用します。

## オペレーター向け（非エンジニア）

1. **初回サインインはパスワードを使います。** `/login` にアクセスしてサインインします（または新規登録します。最初のユーザーがサイト管理者になります）。
2. **アカウントページを開きます。** サイドバー下部のメールアドレスをクリックします。
3. **パスキーを追加します。** **パスキーを追加**をクリックし、デバイスのプロンプト（Face ID / Touch ID / セキュリティキー）に従います。パスキーはこのサイトとこのデバイス / ブラウザ（またはプラットフォームの同期キーチェーン）に紐づきます。
4. **次回はパスキーでサインインします。** ログイン画面ではメールアドレスが事前入力されています。**パスキーでサインイン**をクリックしてプロンプトを承認すればサインイン完了です。

複数のパスキー（デバイスごとに 1 つなど）を登録でき、アカウントページからいつでも削除できます。最後のパスキーを削除してもパスワードにフォールバックするだけで、ロックアウトされることはありません。

ログイン画面に「このアカウントにはまだパスキーが登録されていません」と表示された場合は、まずパスワードでサインインし、アカウントページからパスキーを追加してください。

## エンジニア向け（サイト構築者）

デフォルト設定は以下の環境でそのまま動作します:

- **Amplify Hosting ドメイン**（`*.amplifyapp.com`）
- **`localhost` サンドボックス**（`npm run sandbox` + `localhost:3000`）

いずれの場合も、Amplify がブラウザのドメインから WebAuthn の **Relying Party (RP) ID** を自動解決します。

### CDN 配下のカスタムドメイン

管理画面を**独自 CDN 配下のカスタムドメイン**で配信している場合（[cdn-fronting-tips.ja.md](./cdn-fronting-tips.ja.md) 参照）、自動解決された RP ID がブラウザの見る URL と一致せず、パスキーサインインが `SecurityError` で失敗します。管理画面では「このドメインではパスキーが設定されていません」と表示されます。

`amplify/auth/resource.custom.ts` で、オペレーターがアクセスする **bare domain**（プロトコル・パスなし）を RP ID に固定してください:

```ts
import type { AmplessAuthConfigOpts } from '@ampless/backend'

export const authCustomizations: Pick<AmplessAuthConfigOpts, 'webAuthn'> = {
  webAuthn: { relyingPartyId: 'admin.example.com' },
}
```

RP ID は管理画面を配信する登録可能ドメイン（またはその親ドメイン）でなければなりません。たとえば `example.com` や `admin.example.com` は有効で、`https://admin.example.com/` やパス付きは無効です。編集後に再デプロイしてください。

### パスキーの無効化

パスワードのみで運用するには:

```ts
export const authCustomizations: Pick<AmplessAuthConfigOpts, 'webAuthn'> = {
  webAuthn: false,
}
```

これにより Cognito 設定から `webAuthn` キーが除外され、User Pool はパスワードのみのサインインポリシーになります。

### ⚠️ RP ID の変更は既存パスキーを無効化します

WebAuthn の認証情報は登録時の RP ID に紐づきます。**オペレーターがパスキーを登録した後に `relyingPartyId` を変更すると、登録済みの認証情報がすべて無効化され**、アカウントページから再登録が必要になります。チームに展開する前に正しいドメインを選んでください。パスワードフローはその間も動作し続けるため、誰もロックアウトされません。

## 仕組み

- **バックエンド** — `amplessAuthConfig({ webAuthn })`（`@ampless/backend`）が `loginWith.webAuthn` を設定します。テンプレートはこのノブを `amplify/auth/resource.custom.ts`（`update-ampless` が上書きしないサイト固有ファイル）経由で設定します。[`@ampless/backend` README](../packages/backend/README.ja.md) を参照してください。
- **サインイン** — ログイン画面は `signIn({ options: { authFlowType: 'USER_AUTH', preferredChallenge: 'WEB_AUTHN' } })` を実行し、Amplify がブラウザの WebAuthn セレモニーを行います。
- **登録 / 一覧 / 削除** — アカウントページは `associateWebAuthnCredential` / `listWebAuthnCredentials` / `deleteWebAuthnCredential` を使用します。登録にはサインイン済みセッションが必要なため、パスワードログインは削除できません。

## 要件

- `@ampless/backend` の peer `@aws-amplify/backend` >= `1.19.0`（パスキー対応はここで追加されました）
- `@ampless/admin` の peer `aws-amplify` >= `6.17.0`（クライアント側 WebAuthn API）
- WebAuthn プラットフォーム認証器に対応したブラウザ + プラットフォーム（現在の主要ブラウザはすべて対応）

`update-ampless` はこれらをテンプレートと同期して維持するため、既存サイトもアップグレード時に正しいバージョンを取得します。
