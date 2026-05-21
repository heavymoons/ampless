> English: [14-roadmap.md](./14-roadmap.md)
> 
## 14. ロードマップ

### リリース戦略

ampless は **v1.0 RC に到達するまで非公開で開発する**。

- 開発判断は「自分が運用したい複数のサイトを ampless で動かせるか」を基準にする（ドッグフード優先）
- v1.0 RC のトリガーは **(a)** ドッグフード対象サイトの運用に耐える完成度 + **(b)** ampless 自体で構築した紹介ページが用意できている、の両方
- そのタイミングで GitHub repo を public 化、`pnpm release` で npm publish、紹介ページを同時公開する
- それまでは外部ユーザー向けの README / Quick Start / マーケティングコピーは投資せず、コア機能 + ドキュメント (設計書) の整備に集中する
- 内部バージョン番号は changeset で通常通り bump し続ける（公開していないだけで versioning は連続）

WordPress 互換性は **WXR データインポートのみスコープに入れ**、プラグイン / テーマ / Gutenberg ブロックの互換は対象外。

---

### v0.1 (済 — 内部リリース)

- [x] CLI ウィザード (`npx create-ampless@latest`)
- [x] Core ライブラリ（コンテンツ CRUD、プラグインコントラクト、共通ユーティリティ）
- [x] 管理画面（コンテンツ CRUD、tiptap エディタ、メディアアップロード）
- [x] ブログテーマ（`templates/blog`）
- [x] Cognito 認証（email + password、forgot-password フロー）
- [x] MCP Server（`@ampless/mcp-server`、stdio transport、Cognito SRP authn、7 tools）
- [x] コアプラグイン: SEO（sitemap.xml + OGP）、RSS（feed.xml）、Webhook（HMAC 署名 POST）
- [x] trust_level 別 Lambda 基盤（untrusted / trusted、DynamoDB Streams → SQS）
- [x] AppSync API key 自動更新ジョブ（月次 EventBridge → UpdateApiKey）
- [x] editor 信頼モデルの仕様化（`unfiltered_html` ライク）

---

### v0.x (進行中 — ドッグフードを通じて積み上げ)

ドッグフード対象サイトを ampless で立てるために必要な機能を優先順に。粒度ごとに changeset を切り、まとまった単位で v0.x → v0.(x+1) に bump する運用。

#### マルチサイト基盤（最優先）
- [ ] `byStatus` GSI を `siteId+status` 複合キーに改修（v0.1 単一サイト前提を解除）
- [ ] hostname → `siteId` ルーティング（middleware.ts 本実装、サブドメインも完全別ドメインも同じ仕組みで対応）
- [ ] cms.config の `sites.{id}.domains[]` を実装に反映（複数サイトの公開設定、1 サイトに複数ドメイン紐付け可）
- [ ] 管理画面のサイト切り替え UI
- [ ] Amplify Hosting カスタムドメインの運用ガイド（DNS / SSL / 別ドメイン追加手順）

**SSR キャッシュとマルチドメインのトレードオフ:**

Amplify Hosting の内部 CloudFront は cache key に Host を含めず、ユーザーが Cache Policy / Lambda@Edge を触れないため、マルチドメインで SSR レスポンスをキャッシュさせると site1 と site2 の同 path が衝突する。これにより:

- **シングルサイト運用**（`sites` 未設定 or 1 サイト）: SSR レスポンスに `Cache-Control: public, s-maxage=...` を出して CloudFront キャッシュ活用 → Lambda 起動回数を削減
- **マルチサイト運用**（`sites` 2 件以上）: middleware が `Cache-Control: private, no-store` を強制してキャッシュを完全 OFF（衝突を避ける代償として PV / Lambda コスト増）

切り替えは `cms.config.sites` の件数で自動判定。両立は v1.0 後に Amplify Hosting を捨てて自前 CDK + CloudFront に移行した時の課題として残す。

#### テーマ / 見た目カスタマイズ
- [ ] `configSchema` ベースの軽カスタマイズ（primaryColor、フォント、ロゴ、sidebar 切替）
- [ ] テーマ追加（ランディングページ、ポートフォリオ、ドキュメントサイト）
- [ ] **`@ampless/theme-dads`** — デジタル庁デザインシステム準拠テーマ。`@digital-go-jp/tailwind-theme-plugin`（MIT、Tailwind v4 公式対応）と React sample components（MIT）を組み合わせて、レイアウト含めて DADS 仕様で配信できるテーマを公式提供。日本語・行政・公共向けサイトでの利用シナリオを意識
- [ ] テーマ切り替え + iframe プレビュー（管理画面上）

#### MCP / AI 連携の拡張
- [ ] MCP HTTP transport（`.mcp.json` に PAT を貼って使う一般的な流儀）
- [ ] MCP アクセストークン発行 UI（管理画面）
- [ ] AI プロバイダ抽象レイヤー
- [ ] 校正 / 要約 プラグイン

#### コンテンツ周り
- [ ] Markdown / HTML canonical 対応（tiptap 以外を編集時の一級扱い）
- [ ] before-hooks（プラグインによる validation / 書き換え）
- [ ] メディア系イベント（`media.uploaded` / `media.deleted` の処理経路）

#### 運用品質
- [ ] CloudWatch ダッシュボード自動生成
- [ ] DLQ アラーム
- [ ] Cognito User Pool の本番 SES 設定ガイド + 自動セットアップ

#### 移行ツール（必要になったら）
- [ ] WXR インポート（WordPress からの記事 / メディア取り込み）

ドッグフード対象に既存 WordPress サイトがあれば優先度が上がる項目。新規サイトばかりなら v1.0 RC 直前の余裕枠で対応すれば足りる。

---

### v1.0 RC（公開トリガー）

**v1.0 のスコープ基準:** 「コア + 公式プラグインだけでサイト運営が成立すること」。サードパーティ拡張のための **拡張余地**（プラグイン契約、trust_level、イベント基盤）は v1.0 までに確保するが、配布機構 / マーケットプレイス / 動的プラグインロード自体は v1.0 では実装しない（WordPress 的な「プラグインありきで初めて使える」運用にしない方針）。

到達条件:
- 自分が運用したい複数のサイトが ampless 上で動いている
- ampless 自身の紹介ページ（プロダクトページ）が ampless で構築されている
- 素の `npx create-ampless@latest` + 公式プラグインだけでブログ運営できる動線が一本通っている

このタイミングで:
- GitHub repo を public 化
- `pnpm release` で全パッケージを npm publish
- 紹介ページを同時公開

---

### v1.0 安定版（公開後）

公開後にコア機能としてまだ磨きたい項目:

- [ ] 管理画面の完成度向上（ユーザー管理画面、設定画面、メディア管理 UI）
- [ ] カスタムコンテンツタイプ（`defineSchema` の本格実装）
- [ ] REST API（外部システムからの読み書き）
- [ ] eject 対応（テーマをローカルコピーに切り替え）
- [ ] ドキュメント整備（外部向け Quick Start、Plugin author guide、Theme author guide）

---

### v2.0 以降（拡張系・将来構想）

サードパーティ拡張のエコシステム機能はこちら。v1.0 までに **設計上の余地** は仕込んでおくが、実装は v2.0 以降:

- [ ] サードパーティプラグイン（S3 + ランタイムロード）
- [ ] privileged プラグイン対応（capabilities ベース動的 IAM）
- [ ] プラグインマーケットプレイス（API + Web UI）
- [ ] quickjs-emscripten ランタイムサンドボックス
- [ ] 管理画面からの Git 不要アップデート
- [ ] マルチ言語コンテンツ
- [ ] E コマース対応
