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

### v0.x (進行中 — ドッグフードを通じて積み上げ)

ドッグフード対象サイトを ampless で立てるために必要な機能を優先順に。粒度ごとに changeset を切り、まとまった単位で v0.x → v0.(x+1) に bump する運用。

#### シングルサイトモデル + エッジキャッシュ（最優先）
- [x] **アセット bytes 向け** CloudFront キャッシュ戦略：`/api/media/...` と静的バンドルの `/<slug>/<path>` ルートが S3 オブジェクトを Lambda レスポンスとして stream back するようになり（旧実装の 302 presigned リダイレクトではなく）、Amplify Hosting の CloudFront エッジキャッシュが repeat read を吸収する。6 MB 超のファイルは引き続き 302 presigned 経路にフォールバック。アセットメタ（size / mimeType）は Media DynamoDB 行と `post.metadata.files` に永続化し、読み出し側で HEAD を回避する。
- [ ] **テーマ付き投稿 HTML レスポンス向け** CloudFront キャッシュ戦略：SSR レスポンスに `Cache-Control: public, s-maxage=...` を出して CloudFront キャッシュを活用し Lambda 起動回数を削減（Amplify Hosting の内部 CloudFront は cache key に Host を含めず Cache Policy / Lambda@Edge も触れないため、1 デプロイ = 1 サイトに固定するのが最も素直）
- [ ] Amplify Hosting カスタムドメインの運用ガイド（DNS / SSL / 別ドメイン追加手順）

#### テーマ / 見た目カスタマイズ
- [ ] `configSchema` ベースの軽カスタマイズ（primaryColor、フォント、ロゴ、sidebar 切替）
- [ ] テーマ追加（ランディングページ、ポートフォリオ、ドキュメントサイト）
- [ ] **`@ampless/theme-dads`** — デジタル庁デザインシステム準拠テーマ。`@digital-go-jp/tailwind-theme-plugin`（MIT、Tailwind v4 公式対応）と React sample components（MIT）を組み合わせて、レイアウト含めて DADS 仕様で配信できるテーマを公式提供。日本語・行政・公共向けサイトでの利用シナリオを意識
- [ ] テーマ切り替え + iframe プレビュー（管理画面上）

#### MCP / AI 連携の拡張
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
