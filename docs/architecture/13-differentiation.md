## 13. EmDash との差別化ポイント

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
| コンテンツ保存 | Portable Text 固定 | マルチフォーマット（tiptap/Markdown/HTML） |
| AI 連携 | なし（v1 時点） | MCP Server + AI プロバイダ抽象レイヤー |
| フックシステム | 不明 | before/after フック + Webhook（外部連携の汎用口） |
| マルチサイト | 非対応 | サブドメインベースのマルチサイト |
| エコシステム | Cloudflare ユーザー | AWS ユーザー（圧倒的多数） |

---
