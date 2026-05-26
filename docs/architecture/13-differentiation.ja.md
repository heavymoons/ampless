> English: [13-differentiation.md](./13-differentiation.md)
> 
## 13. EmDash との差別化

| 観点 | EmDash | ampless |
|------|--------|---------|
| ターゲットインフラ | Cloudflare（Workers / D1 / R2） | AWS（Amplify Gen 2：Lambda / DynamoDB / S3 / AppSync / Cognito） |
| プラグイン分離 | V8 isolate（Workers） | trust_level ごとに IAM スコープ済みの Lambda |
| サンドボックスの可搬性 | Cloudflare 環境でしか意味を持たない | 任意の AWS アカウントで成立 |
| 権限制御 | カスタムの capability 宣言 | IAM（業界標準） |
| 監査 | カスタム | CloudTrail（AWS 標準） |
| フロントエンド | Astro | Next.js |
| データベース | D1（SQLite） | DynamoDB |
| コンテンツ保存形式 | Portable Text（固定） | マルチフォーマット：`tiptap` / `markdown` / `html` / `static` |
| エディタ | カスタム（tiptap + Portable Text 変換層） | tiptap、本文をそのまま保存 — 余計な変換層なし |
| AI 連携 | v1 ではなし | MCP HTTP サーバ、11 ツール（Bearer トークンで admin 相当のエージェント） |
| フック面 | （非公開） | Stream → SQS → trust_level Lambda 経由の `after:*` イベントフック、外向き Webhook、リクエスト時の純関数メタデータフック |
| テーマモデル | （1 デプロイ = 1 テーマ） | マルチテーマインストール（6 種出荷）、再デプロイなしで管理 UI から切り替え |
| 公開読み取り認証 | n/a（Workers が in-line で処理） | AppSync API キー + draft 除外カスタムリゾルバ |
| エコシステム | Cloudflare ユーザ | AWS ユーザ（圧倒的に大きいコミュニティ） |

上位の差別化軸は**ターゲットインフラ**。ampless は「AWS 版 EmDash」 — 同じ姿勢（開発者が組むサイト、プラグイン中心の拡張性、AI エージェントネイティブな MCP）を、Cloudflare の Workers モデルではなく AWS の Lambda + IAM モデル上で実装したもの。

---
