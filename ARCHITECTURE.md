# Amplify CMS 設計方針書

## 1. プロジェクト概要

### コンセプト
AWS Amplify をネイティブターゲットとしたオープンソースCMS。
Cloudflare EmDash が Cloudflare Workers 向けに設計されているのと同じ位置づけで、AWS エコシステム向けの「EmDash的なもの」を目指す。

### 背景
- EmDash は Cloudflare Workers/D1/R2 にロックインされており、AWS ユーザーにとっては選びにくい
- AWS Amplify をネイティブターゲットとしたオープンソース CMS は現時点で空白地帯
- Amplify Gen 2 の TypeScript ファースト設計と相性が良い

### ターゲットユーザー
- AWS を既に使っている開発者・技術者
- WordPress のセキュリティ問題に疲弊しているチーム
- 非開発者の管理は v1 ではスコープ外（git push ベースの運用を前提）

---

## 2. 技術スタック

| レイヤー | 技術 | 備考 |
|---------|------|------|
| フレームワーク | Next.js (App Router) | Astro(EmDash)より開発者人口が多い |
| バックエンド | Amplify Gen 2 | CDK ベース、TypeScript で完結 |
| データベース | DynamoDB | Amplify ネイティブ、サーバーレス |
| ストレージ | S3 | メディアファイル |
| 認証 | Cognito | Amplify Auth 標準 |
| プラグイン実行 | Lambda（リージョン） | trust_level 別に複数関数 |
| CDN | CloudFront | Amplify Hosting が自動構成 |
| ライセンス | MIT | EmDash と同じ。企業利用のハードルを下げる |

### エッジ実行について
CloudFront Functions / Lambda@Edge はプラグイン実行には使わない。
理由: Amplify が自動生成する CloudFront にカスタムエッジ関数を差し込む正規の方法がない。
テキスト変換程度の処理はリージョン Lambda で 1-2ms で完了するため実用上問題なし。
CloudFront のキャッシュが効けばそもそも Lambda は呼ばれない。

---

## 3. コンテンツ管理

### データモデル
- コンテンツは Portable Text（構造化 JSON）で保存（EmDash と同じ方針）
- コンテンツとプレゼンテーションを分離し、Web / モバイル / API 等マルチ出力に対応
- カスタムコンテンツタイプは管理画面からスキーマ定義 → 専用の DynamoDB テーブルを生成
- WordPress の「全部を1つの posts テーブルに詰め込む」問題を回避

### WordPress からの移行
- WXR ファイルインポートに対応
- 投稿、ページ、メディア、タクソノミーの移行をサポート
- WordPress プラグイン・テーマは移行不可（アーキテクチャが根本的に異なる）
- カスタム投稿タイプ（CPT）と ACF は手動スキーママッピングが必要

---

## 4. プラグインアーキテクチャ

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

- **IAM 権限**: content テーブル読み取り、S3 メディア読み取り
- **できること**: 公開コンテンツの参照、メディアファイルの読み取り
- **できないこと**: 書き込み、他テーブルへのアクセス、外部サービス連携
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
  "capabilities": ["ses:SendEmail", "dynamodb:PutItem:form-submissions"]
}
```

capabilities からIAMポリシーを動的に組み立てる:

```typescript
const capabilityMap = {
  'ses:SendEmail': {
    actions: ['ses:SendEmail'],
    resources: ['arn:aws:ses:*:*:identity/noreply@your-site.com']
  },
  'dynamodb:PutItem:form-submissions': {
    actions: ['dynamodb:PutItem'],
    resources: ['arn:aws:dynamodb:*:*:table/cms-form-submissions']
  }
};
```

### プラグインマニフェスト

```json
{
  "name": "seo-plugin",
  "version": "1.0.0",
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

### 外部通信の制御
- untrusted/trusted Lambda はデフォルトでインターネットアクセス可能
- 対策案: VPC プライベートサブネットに配置（NAT なし）→ 完全遮断
- 現実的判断: プラグインが読めるのは公開コンテンツのみであり、漏洩の実害が小さい
  → v1 では VPC 制限なし。privileged のみ必要に応じて VPC 配置を検討

---

## 5. プラグインの配布とインストール

### A方式: ビルドタイム（コアプラグイン）

npm パッケージとして配布。ビルド時にバンドルされる。

```bash
npm install @your-cms/plugin-seo
```

```typescript
// amplify/plugins.ts
import { defineCmsPlugins } from 'your-cms';
export const plugins = defineCmsPlugins([
  '@your-cms/plugin-seo',
  '@your-cms/plugin-contact-form',
]);
```

git push → Amplify 自動ビルド・デプロイ。

利点: npm のバージョン管理・lockfile・セキュリティ監査がそのまま使える。
欠点: 追加のたびにデプロイが走る。非開発者には操作できない。

### B方式: ランタイム（サードパーティプラグイン）

管理画面からインストール。プラグインコードを S3 に保存し、Lambda 実行時に動的ロード。

```
管理画面「プラグイン追加」
  → バンドル済みJSを S3 にアップロード
  → マニフェストを DynamoDB に登録
  → Lambda 実行時に S3 からコード取得
  → new Function() で実行（trust_level に応じた Lambda で）
```

キャッシュ戦略:
1. Lambda メモリ内キャッシュ（ウォームスタート間で保持）
2. /tmp ファイルキャッシュ（コールドスタートでも高速）
3. S3 から取得（完全初回のみ）

プラグイン開発者は esbuild 等でバンドル済み単一 JS ファイルとして配布。

### v1 方針
- コアプラグインは A 方式（npm）
- サードパーティプラグインは B 方式（S3 + ランタイムロード）
- 両方式を組み合わせたハイブリッド運用

---

## 6. CMS 本体のアップデート

### コア更新

CMS コアは npm パッケージとして配布。

```bash
npm update your-cms
git push  # → Amplify 自動デプロイ
```

プロジェクト構造でコアとユーザーカスタマイズを分離:

```
├── node_modules/your-cms/   ← npm 管理。ユーザーは触らない
├── amplify/
│   ├── backend.ts           ← CMS テンプレート + ユーザーカスタム
│   ├── data/resource.ts     ← スキーマ定義
│   └── functions/           ← プラグイン Lambda
├── themes/my-theme/         ← ユーザーが自由に編集
└── cms.config.ts            ← ユーザー設定ファイル
```

### DB マイグレーション

```bash
npx your-cms migrate
```

DynamoDB は RDB と異なり破壊的変更が少ない。
GSI 追加やアトリビュート追加は既存データに影響しない。

### CDK リソース更新

npm update → git push で Amplify ビルドパイプラインが
amplify/backend.ts の変更を検知して CDK デプロイを実行。
ユーザーが意識する必要はない。

---

## 7. セットアップ体験

### ユーザーの操作フロー

```bash
$ npx create-your-cms@latest

? サイト名: my-blog
? テーマ: ブログ / ランディングページ / ポートフォリオ
? 認証方法: パスキー / メールリンク / Cognito 標準
? プラグイン: [x] SEO  [x] お問い合わせフォーム  [ ] Analytics
? デプロイ先: ローカル開発 / Amplify (AWS)

✅ プロジェクトを生成しました
次のステップ:
  cd my-blog
  npx ampx sandbox    # ローカル開発用バックエンド起動
  npm run dev          # フロントエンド起動
```

CLI ウィザードが amplify/ 配下のリソース定義を動的に生成。
ユーザーは裏で CDK が動いていることを意識しなくてよい。

### 本番デプロイ

```bash
git init && git add . && git commit -m "init"
git remote add origin <your-repo>
git push
# → Amplify コンソールで Git リポジトリを接続
# → 自動ビルド・デプロイ
```

### EmDash との比較

| ステップ | EmDash (Cloudflare) | 本 CMS (Amplify) |
|---------|--------------------|--------------------|
| 初期化 | `npm create emdash@latest` | `npx create-your-cms@latest` |
| ローカル開発 | `npx wrangler dev` | `npx ampx sandbox` + `npm run dev` |
| 本番デプロイ | `npx wrangler deploy` | Amplify コンソールで git 接続 |
| 要アカウント | Cloudflare（無料） | AWS（無料枠あり） |
| 最大のハードル | wrangler 設定 | AWS アカウント + IAM 初期設定 |

### 配布方法

1. **npm create テンプレート**（メイン）: CLI ウィザードでプロジェクト生成
2. **GitHub Template Repository**: 「Use this template」ボタンでフォーク
3. **CDK コンストラクト**（上級者向け）: 既存 Amplify プロジェクトへの追加

---

## 8. EmDash との差別化ポイント

| 観点 | EmDash | 本 CMS |
|------|--------|--------|
| ターゲットインフラ | Cloudflare | AWS (Amplify) |
| プラグイン分離 | V8 isolate (Workers) | IAM ポリシー (Lambda) |
| サンドボックス機能 | Cloudflare 環境でのみ有効 | あらゆる AWS 環境で有効 |
| 権限制御 | 独自 capability 宣言 | IAM（業界標準） |
| 監査 | 独自 | CloudTrail（AWS 標準） |
| フロントエンド | Astro | Next.js |
| DB | D1 (SQLite) | DynamoDB |
| セルフホスト時の分離 | 非対応 | IAM があれば同等に機能 |
| エコシステム | Cloudflare ユーザー | AWS ユーザー（圧倒的多数） |

---

## 9. ロードマップ

### v0.1 (MVP)
- [ ] CLI ウィザード (`npx create-your-cms@latest`)
- [ ] 管理画面（コンテンツ CRUD）
- [ ] ブログテーマ 1 種
- [ ] Cognito 認証
- [ ] コアプラグイン: SEO、RSS
- [ ] trust_level 別 Lambda 基盤（untrusted / trusted）

### v0.2
- [ ] WordPress WXR インポート
- [ ] サードパーティプラグイン（S3 + ランタイムロード）
- [ ] プラグインマーケットプレイス（API のみ）
- [ ] privileged プラグイン対応
- [ ] テーマ追加（ランディングページ、ポートフォリオ）

### v1.0
- [ ] 管理画面の完成度向上
- [ ] カスタムコンテンツタイプ
- [ ] メディアライブラリ
- [ ] MCP サーバー（AI エージェント対応）
- [ ] ドキュメント整備

### v2.0（将来構想）
- [ ] quickjs-emscripten によるランタイムサンドボックス追加
- [ ] マーケットプレイス Web UI
- [ ] 管理画面からの Git 不要アップデート
- [ ] マルチ言語コンテンツ
- [ ] E コマース対応