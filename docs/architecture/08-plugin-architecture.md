## 8. プラグインアーキテクチャ

### 設計思想
EmDash が V8 isolate でプラグインをサンドボックス化しているのに対し、
本 CMS は **AWS IAM をサンドボックスとして活用**する。
Lambda 関数レベルの分離 + IAM ポリシーによる権限制御で、
isolated-vm 等のランタイムサンドボックスを不要にする。

### trust_level 別 Lambda 構成

3 段階の信頼レベルごとに専用の Lambda 関数を用意する。

#### untrusted（信用できないプラグイン）

- **IAM 権限**: なし（ゼロ）
- **できること**: 純粋な JS 実行のみ。入力テキストの変換・加工
- **できないこと**: AWS リソースへのアクセス全般
- **用途**: Markdown 装飾、文字数カウント、OGP テキスト生成
- **メモリ**: 128-256MB
- **防御**: new Function() でグローバルオブジェクト（process, require 等）を隠蔽

```javascript
function executePlugin(code, cmsApi) {
  const safeScope = {
    process: undefined,
    require: undefined,
    global: undefined,
    globalThis: undefined,
    Buffer: undefined,
    cms: cmsApi
  };
  const keys = Object.keys(safeScope);
  const values = Object.values(safeScope);
  const fn = new Function(...keys, `"use strict";\n${code}`);
  return fn(...values);
}
```

#### trusted（まあまあ信用できるプラグイン）

- **IAM 権限**: content テーブル読み取り、S3 public 読み取り、plugin-data 自分の PK 読み取り
- **できること**: 公開コンテンツの参照、メディアファイルの読み取り、自分のプラグインデータ読み取り
- **できないこと**: 書き込み、S3 private アクセス、外部サービス連携
- **用途**: SEO メタタグ生成、関連記事表示、サイトマップ生成、RSS
- **メモリ**: 256-512MB

#### privileged（すごく信用できるプラグイン）

- **IAM 権限**: capabilities 宣言に基づく動的生成ポリシー
- **できること**: メール送信、フォームデータ保存、外部 API 連携等
- **できないこと**: 宣言していない capability の操作
- **用途**: お問い合わせフォーム、メール通知、Analytics 連携、決済
- **メモリ**: 512MB

```json
{
  "name": "contact-form",
  "version": "1.0.0",
  "trust_level": "privileged",
  "capabilities": ["ses:SendEmail", "plugin-data:write", "s3:private:write"]
}
```

capabilities からIAMポリシーを動的に組み立てる:

```typescript
function buildPluginPolicy(pluginName: string, capabilities: string[]) {
  const statements = [];

  for (const cap of capabilities) {
    switch (cap) {
      case 'ses:SendEmail':
        statements.push({
          actions: ['ses:SendEmail'],
          resources: ['arn:aws:ses:*:*:identity/noreply@example.com']
        });
        break;
      case 'plugin-data:write':
        statements.push({
          actions: ['dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:DeleteItem'],
          resources: ['arn:aws:dynamodb:*:*:table/ampless-plugin-data'],
          condition: { 'dynamodb:LeadingKeys': [`plugin#${pluginName}`] }
        });
        break;
      case 's3:private:write':
        statements.push({
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [`arn:aws:s3:::ampless-bucket/private/plugins/${pluginName}/*`]
        });
        break;
    }
  }

  return statements;
}
```

### API 仕様バージョン

プラグインとテーマの仕様（definePlugin / defineTheme の API）にはバージョンを付与する。
ampless コアが仕様を破壊的変更する際にインクリメントする。

```typescript
// ampless コアが現在サポートする仕様バージョン
const SUPPORTED_PLUGIN_API_VERSIONS = [1]
const SUPPORTED_THEME_API_VERSIONS = [1]
```

プラグイン・テーマ側は `apiVersion` を宣言する:

```typescript
// プラグイン
export default definePlugin({
  apiVersion: 1,
  name: 'seo-plugin',
  trust_level: 'trusted',
  ...
})

// テーマ
export default defineTheme({
  apiVersion: 1,
  name: 'Blog',
  ...
})
```

コアは `apiVersion` を見てロード方法を分岐する。
古い仕様も一定期間サポートし、非対応の場合は明確なエラーを出す。

```typescript
function loadPlugin(manifest) {
  if (!SUPPORTED_PLUGIN_API_VERSIONS.includes(manifest.apiVersion)) {
    throw new Error(
      `Plugin "${manifest.name}" requires apiVersion ${manifest.apiVersion}, ` +
      `but this version of ampless supports: ${SUPPORTED_PLUGIN_API_VERSIONS.join(', ')}`
    )
  }
  // apiVersion に応じたロード処理
}
```

### プラグインマニフェスト

```json
{
  "apiVersion": 1,
  "name": "seo-plugin",
  "trust_level": "trusted",
  "description": "メタタグと OGP を自動生成",
  "entry": "bundle.js"
}
```

### Lambda メモリ設定の方針
- 128MB は AWS が最低限の処理にしか推奨しておらず、CPU が極端に少ない
- 128MB と 512MB でコストが同じ（実行時間短縮で GB-seconds が相殺）ケースが多い
- untrusted: 256MB / trusted: 256-512MB / privileged: 512MB を基本とする
- コールドスタートは Node.js で 200-400ms 程度。CMSプラグイン用途では問題にならない
  - アクセスが多い → Lambda がウォーム状態を維持（コールドスタート発生率 1% 未満）
  - アクセスが少ない → 数百 ms の遅延は許容範囲

### ランタイムサンドボックスについて（v1 では不採用）
- isolated-vm は Node.js 20+ で `--no-node-snapshot` フラグが必要
  → Lambda マネージドランタイムでは起動フラグを制御できず、コンテナイメージ Lambda 必須
  → コールドスタート悪化、メンテナンスモード、ネイティブバイナリビルドの問題
- v1 では IAM による分離で十分と判断
- v2 以降でマーケットプレイス公開時に quickjs-emscripten 等を検討

### プラグインのデータストレージ

プラグインが独自のデータを保存する仕組みを提供する。
プラグインごとに新しい DynamoDB テーブルを作成するのではなく、
共用テーブルと S3 パス分離で対応する。

#### S3 バケット設計

```
s3://ampless-bucket/
  public/                         ← パブリックアクセス可（バケットポリシーで公開）
    media/                        ← メディアファイル（画像・動画）
    plugins/{pluginName}/         ← プラグインの公開ファイル
  private/                        ← Lambda からのみアクセス可
    plugins/{pluginName}/         ← プラグインの非公開データ
```

| パス | アクセス | 用途例 |
|------|---------|--------|
| `public/media/` | next/image 経由（デフォルト）または直接 S3 URL | アップロード画像（next/image）、動画・PDF（S3直接） |
| `public/plugins/{name}/` | 直接 S3 URL | OGP 画像、サイトマップ、RSS、CSS/JS ウィジェット |
| `private/plugins/{name}/` | Lambda のみ | フォーム送信データ、API キー、設定ファイル |

`public/` 以下はバケットポリシーで公開する。
メディアの配信方式は `cms.config.ts` の `media.delivery` で切り替え可能（詳細は §3 メディア管理を参照）。
動画・PDF など大容量ファイルは Lambda の 6MB 制限を避けるため常に直接 S3 URL で配信する。

```json
{
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::ampless-bucket/public/*"
}
```

将来 CloudFront を S3 の前に追加する場合も、パス構造を変えずに対応できる。

注: Amplify Storage はデフォルトで pre-signed URL（署名付き一時 URL）を使うが、
CMS のメディア配信には永続的な URL が必要なため、`public/` パスは明示的にパブリック化する。

#### DynamoDB 共用テーブル（plugin-data）

プラグイン固有のデータは共用テーブルに保存する。
PK にプラグイン名を含め、IAM の条件キーで行レベルのアクセス制御を行う。

```
ampless-plugin-data テーブル
  PK: "plugin#{pluginName}"
  SK: プラグインが自由に決める
  data: JSON
```

```json
{"PK": "plugin#contact-form", "SK": "submission#2026-04-04#001", "data": {"name": "田中", "email": "..."}}
{"PK": "plugin#contact-form", "SK": "submission#2026-04-04#002", "data": {"name": "鈴木", "email": "..."}}
{"PK": "plugin#analytics",    "SK": "pageview#2026-04-04",       "data": {"count": 1234}}
```

IAM ポリシーで自分の PK のみアクセス可能に制限:

```json
{
  "Effect": "Allow",
  "Action": ["dynamodb:Query", "dynamodb:PutItem", "dynamodb:DeleteItem"],
  "Resource": "arn:aws:dynamodb:*:*:table/ampless-plugin-data",
  "Condition": {
    "ForAllValues:StringLike": {
      "dynamodb:LeadingKeys": ["plugin#contact-form"]
    }
  }
}
```

#### 専用テーブル作成を避ける理由
- テーブル作成は CDK デプロイ（= git push）が必要で、管理画面からのインストール（B 方式）と相性が悪い
- AWS アカウントあたりのテーブル数にソフトリミットがある（デフォルト 2,500）
- プラグイン削除時の cleanup が複雑になる
- 共用テーブルの Single Table Design は DynamoDB のベストプラクティス

#### trust_level 別アクセス権限

| trust_level | DynamoDB (plugin-data) | S3 public/ | S3 private/ |
|-------------|----------------------|------------|-------------|
| untrusted | 不可 | 不可 | 不可 |
| trusted | 読み取り（自分の PK） | 読み取り（自分のパス） | 不可 |
| privileged | 読み書き（自分の PK） | 読み書き（自分のパス） | 読み書き（自分のパス） |

trusted が S3 public を読めるのは、そもそも HTTP で公開されているデータだから。
private はセンシティブなデータを含むため privileged のみ。

### 外部通信の制御
- untrusted/trusted Lambda はデフォルトでインターネットアクセス可能
- 対策案: VPC プライベートサブネットに配置（NAT なし）→ 完全遮断
- 現実的判断: プラグインが読めるのは公開コンテンツのみであり、漏洩の実害が小さい
  → v1 では VPC 制限なし。privileged のみ必要に応じて VPC 配置を検討

---
