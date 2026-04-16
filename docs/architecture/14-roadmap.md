## 14. ロードマップ

### v0.1 (MVP)
- [ ] CLI ウィザード (`npx create-ampless@latest`)
- [ ] Core ライブラリ（コンテンツ CRUD、権限チェック）
- [ ] 管理画面（コンテンツ CRUD、tiptap エディタ）
- [ ] ブログテーマ 1 種
- [ ] Cognito 認証
- [ ] MCP Server（AI エージェント対応 — 初期から差別化ポイント）
- [ ] `after:content.published` フック + Webhook
- [ ] コアプラグイン: SEO、RSS
- [ ] trust_level 別 Lambda 基盤（untrusted / trusted）

### v0.2
- [ ] Markdown / HTML canonical 対応
- [ ] マルチサイト（サブドメインルーティング）
- [ ] before フック、メディア系イベント
- [ ] AI プロバイダ抽象レイヤー + 校正・要約プラグイン
- [ ] CloudWatch ダッシュボード自動生成 + DLQ アラーム
- [ ] WordPress WXR インポート
- [ ] サードパーティプラグイン（S3 + ランタイムロード）
- [ ] プラグインマーケットプレイス（API のみ）
- [ ] privileged プラグイン対応
- [ ] テーマ追加（ランディングページ、ポートフォリオ）

### v1.0
- [ ] 管理画面の完成度向上
- [ ] カスタムコンテンツタイプ
- [ ] メディアライブラリ
- [ ] REST API
- [ ] ドキュメント整備

### v2.0（将来構想）
- [ ] quickjs-emscripten によるランタイムサンドボックス追加
- [ ] マーケットプレイス Web UI
- [ ] 管理画面からの Git 不要アップデート
- [ ] マルチ言語コンテンツ
- [ ] E コマース対応