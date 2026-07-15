> English: [14-roadmap.md](./14-roadmap.md)
> 
## 14. ロードマップ

### リリース戦略

ampless は 4 段階のリリースパスを歩んでいます: **alpha → beta → RC → stable**。

- **alpha**（完了）: クローズドな開発、リポジトリ非公開、npm `alpha` dist-tag、ドッグフード駆動の機能開発。判断基準は「自分が運用したい複数のサイトを ampless で動かせるか」でした。
- **beta**（現在）: リポジトリは **public**、npm `beta` dist-tag。破壊的変更はまだあり得る（changesets で明示）が、外部ユーザーはインストール可能、外部プラグイン作者は publish 可能。
- **RC**: feature-complete、破壊的変更は予定なし。ドッグフードサイトは最終調整期間中 RC ビルドで運用。
- **stable**（v1.0）: 公開ローンチ。ampless の紹介ページ（ampless 自身で構築）が同時ローンチ。

v1.0 RC の進級条件（前計画から変更なし）: (a) ドッグフード対象サイトの運用に耐える完成度、(b) ampless 自身で構築した紹介ページが用意できている。Beta 進級条件は public launch 前の private blocker checklist で処理済み。内部バージョン番号は 4 段階すべてを通じて changeset で通常通り bump し続ける。

WordPress 互換性は **WXR データインポートのみスコープに入れ**、プラグイン / テーマ / Gutenberg ブロックの互換は対象外。

### ポジショニング（2026-06-07）

ampless はエンジニア向けのカスタマイズベース CMS です — 非エンジニアはポリッシュされた admin で運用します。プラグインはサイトエンジニアが `cms.config.ts` で直接インポート + 設定する npm dep（Astro integration / Next.js plugin パターン）であり、エンジニアがインストール前に各 dep を審査します。v1 の trust framework（`trust_level`、capabilities、IAM スコープ付き Lambda）は**ファーストパーティプラグインの code organization**として実装されています — どの trust 階層の Lambda が各イベントフックを実行するか、`settings.secret` が `trust_level: 'trusted'` を要求するような narrow hard gate、そして capability 宣言による不一致 warning + admin ラベル + 将来の allow-list のサポート。任意のサードパーティ未審査プラグインを自動的に安全に動かすための marketplace-grade automatic sandbox としては設計されていません。マーケットプレイスとランタイムサンドボックスは v2.0+ の探索にのみ先送りされており、エンジニアが審査していないプラグインを安全に動かす必要がある場合にのみ検討します。

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

#### AI-readable publishing（計画中）
公開済みコンテンツを人間と AI の両方が読みやすい形で配信する（[AI_FRIENDLY.ja.md](../AI_FRIENDLY.ja.md) §3–4 の採用 + 公開読み取り専用 MCP endpoint の追加）。CMS を原本とし、Markdown / `llms.txt` / 公開 MCP tool のレスポンスは同じ投稿から導出する公開表現として扱う（MCP Resources / Resource Template は後回し — 初期は tool のみ）。published-only を構造的に強制（published 専用 custom query のみ使用）し、`ai` 設定セクションを無効にしたサイトの挙動は変えない。

- [x] Phase A — canonical Markdown: `AmplessPlugin` manifest への server-safe な `tiptapNodeToMarkdown` adapter + `@ampless/runtime` の `ampless.postToMarkdown(post)` + 公開 `/<slug>.md` ルート（middleware で内部 `/md/<slug>` へ rewrite、published のみ、変換不能ノードは黙って消さずプレースホルダを出力）
- [x] Phase B — AI 向けインデックスと画面導線: `/llms.txt` runtime ルート（Markdown URL つきサイトマップ、上限つき・切り詰めは明記）+ `@ampless/plugin-ai-actions` — 「Markdown で表示」リンク（デフォルトオン）と opt-in の「Claude で開く」/「ChatGPT で開く」リンク（`https://claude.ai/new?q=...` / `https://chatgpt.com/?q=...` prefill、デフォルト OFF — 公式に文書化された契約ではなくコミュニティ慣習のため）を `publicHtmlForPost` 経由で本文の後（または前）に描画する。「Markdown コピー」（クリップボード）はスコープ外とした — `publicHtmlForPost` の sanitizer はインラインイベントハンドラ/`<button>` を drop し、`publicPostScript` は外部の絶対 script `src` のみ対応（インラインスクリプトチャネルなし）— inline-script capability か plugin asset 配信の仕組みが入ったら再検討する。`/llms-full.txt` は必要になるまで後回し（event 駆動 S3 生成、rss/seo パターン）
- [ ] Phase C — 公開読み取り専用 MCP: Next.js runtime が `/api/mcp` で提供する匿名 JSON-RPC endpoint（route factory 方式。plugin の Markdown adapter と `cms.config` に直接アクセスできる）。tool（`list_posts` / `get_post` / `search_posts` / `list_tags`）は published 専用 custom query のみを呼び、`postToMarkdown` を再利用。read-only annotations、paging + 本文サイズ上限。既存 admin MCP（Lambda Function URL + Bearer）は不変
- [ ] Phase D — MCP discovery: `server.json` 生成 + サイト/admin 上の接続手順 + MCP Registry 公開手順。`/.well-known/mcp.json` は Server Card 仕様確定まで実験扱い

#### プラグイン拡張（dogfood 駆動の段階導入）
進行管理の要約はこの文書に集約し、公開 contract は [08-plugin-architecture.ja.md](./08-plugin-architecture.ja.md) に置きます。各 Phase で新 surface を実装で叩く同梱プラグインを 1 つ以上 ship、次 Phase に進む。

- [x] Phase 1: descriptor ベースの head/body 注入 + `AmplessPlugin` への `capabilities` / `instanceId` / `displayName` 追加。同梱第 1 弾: `@ampless/plugin-analytics-ga4`（設定は `cms.config.ts` 直書き）。Contract: [08-plugin-architecture.ja.md](./08-plugin-architecture.ja.md)
- [x] Phase 2: admin 管理の public settings（`/admin/plugins`、S3 cache ミラー）。GA4 の設定を admin UI に移行。プラグイン作者ガイドを新規ドキュメントとして `ampless` tarball + scaffold コピーで配布開始
- [x] Phase 3: trust-level ドッグフード。Phase 3a 完了 — `@ampless/plugin-gtm` + `@ampless/plugin-plausible`（untrusted）を新規バンドルプラグインとして ship、Phase 1/2 の descriptor + admin 設定 API を実物で叩く。Phase 3c 完了 — `writePublicAsset` を runtime key validation + `instanceId ?? name` namespace 強制付きで正式化し、既存 `seo` / `rss` が新 capability surface を宣言。Phase 3b 完了 — `PluginRepeatableField`（object のリスト型 setting）+ `@ampless/plugin-cookie-consent`（untrusted）+ Consent Convention 規約（`window.amplessConsent` グローバル API + 標準イベント）、GA4 / GTM / Plausible には `consentCategory?: string` で gated mode を実装
- [x] Phase 4: 投稿単位 body 注入 API（`publicBodyForPost`）+ `schema` capability + JSON-LD 自動 escape（`escapeJsonLdInlineBody`）。同梱第 1 弾：`@ampless/plugin-schema-jsonld`（untrusted）。テーマの post ページテンプレートが `ampless.publicBodyForPost(post)` を呼んで `<script type="application/ld+json">` 要素を描画
- [x] Phase 5: モノレポ外プラグインの npm install 検証 — 静的 `package.json#amplessPlugin` manifest 規約 + runtime cross-check、`npx create-ampless@beta plugin <name>` scaffold subcommand、プラグイン作者ガイド書き直し。`@ishinao/ampless-plugin-site-verification` を npm 公開して ishinao.net で実装インストール検証済み
- [x] Phase 6d: `publicHtmlForPost` capability + `PublicPostHtmlDescriptor` 型 + `@ampless/runtime` への `sanitize-html` サニタイズ層。同梱第 1 弾：`@ampless/plugin-reading-time`（untrusted）— 英語語数 + CJK 文字数換算による読了時間バッジ。ラベルテンプレートと位置は admin から編集可能。
- [x] Phase 6a: `secretSettings` capability + `PluginSecretField` 型（`default` を `Omit` で除去し漏洩を防止）+ `TrustedPluginRuntimeContext.secret<T>(key)` 非同期アクセサ + `PluginSecret` DynamoDB モデル（admin/editor: 書き込みのみ; IAM Lambda: 読み取りのみ）。`@ampless/plugin-webhook` を `trust_level: 'trusted'` に retrofit し、admin 管理の署名シークレットで再デプロイ不要のキーローテーションを実現。
- [x] Phase 7（embed プラグイン拡張）: `contentFields` capability（予約から昇格）+ `publicPostScript` capability + `Ampless.renderBody(post): Promise<ReactNode>`（pre-1.0 breaking）+ raw route 互換のための `renderBodyHtmlString` + admin editor extension installer (`@ampless/admin/editor`) + iframe-srcDoc プレビューパイプライン（`/admin/preview` Route Handler。page factory の `previewEndpoint` オプションで上書き可能）。最初のプラグイン: `@ampless/plugin-youtube` + `@ampless/plugin-x-embed`（両方 `trusted`、`youtube-nocookie.com` および `platform.twitter.com/widgets.js` 経由で配信）。
- [ ] Phase 6+（各々独立 RFP）: developer 拡張 capability (`adminPage` / `serverRoute` / ...)

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

### Beta（現在の公開プレリリース）

Beta は現在の公開プレリリース段階: GitHub リポジトリは閲覧可能で、npm `beta` dist-tag でパッケージが公開され、外部ユーザーはインストール可能、外部プラグイン作者は publish 可能です。破壊的変更はまだあり得る（changesets と dist-tag バンプで明示）; コントラクトは RC でロックされます。

Beta 進級条件は public beta として公開できる水準まで完了済みです。残る hardening はこのロードマップと通常の GitHub issue で扱います。

---

### v1.0 RC（feature-complete フェーズ）

**v1.0 のスコープ基準:** 「コア + 公式プラグインだけでサイト運営が成立すること」。**拡張余地**（プラグイン契約、`trust_level`、trusted / untrusted SQS + Lambda 分離・capability 宣言・設定ストレージを含むイベント基盤）は v1.0 において**ファーストパーティプラグインの code organization**として確保済み — エンジニアがプラグインの trust 階層と capabilities を宣言し、runtime がイベントフックを対応する Lambda にルーティングする。Narrow hard gate は特定箇所で発火する（最も重要な例として `settings.secret` は `trust_level: 'trusted'` を要求、シークレット読み取りに trusted Lambda の `PluginSecret` テーブルへの IAM 権限が必要なため）。ほとんどの capability 宣言は hard gate ではなく不一致 warning + admin ラベル + 将来の allow-list をサポートする。この surface はファーストパーティ / エンジニア審査済みの npm dep 向けのサイズ設計。任意の未審査サードパーティプラグインを安全に動かすための marketplace-grade automatic sandbox は v1.0 の成果物では**ない**; その作業は v2.0+ の探索に先送りされる。

到達条件:
- メンテナーが運用したい複数のサイトが ampless 上で動いている（本番負荷でドッグフード済み）
- ampless 自身の紹介ページ（プロダクトページ）が ampless で構築可能（v1.0 stable で公開できる状態）
- 素の `npx create-ampless@beta` + 公式プラグインだけでブログ運営できる動線が一本通っている

注: GitHub public 化 + npm `beta` dist-tag への **パブリック化** は beta の開始時点（この RC より 1 段階前）。**紹介ページの同時ローンチ** は v1.0 stable（1 段階後）。4 段階の詳細は上記「リリース戦略」を参照。

---

### v1.0 安定版

フルパブリックローンチ — ampless の紹介ページ（ampless 製）が v1.0 と同時ローンチ。

安定版リリース後にコア機能としてまだ磨きたい項目:

- [ ] 管理画面の完成度向上（ユーザー管理画面、設定画面、メディア管理 UI）
- [ ] カスタムコンテンツタイプ（`defineSchema` の本格実装）
- [ ] REST API（外部システムからの読み書き）
- [ ] eject 対応（テーマをローカルコピーに切り替え）
- [ ] ドキュメント整備（外部向け Quick Start、Plugin author guide、Theme author guide）

---

### v2.0 以降（探索のみ — コミットなし）

これらの項目は **ampless がプラグインマーケットプレイスを必要とする場合のみ探索する**（つまりサイトエンジニアが審査していないプラグインを安全に動かすための経路）。コミット済みの v2.0 成果物では**ない**。v1.0 のポジショニング（エンジニア向けカスタマイズベース CMS、プラグインはエンジニア審査済みの npm dep）はこれらを一切必要としない。

#### Marketplace-grade sandbox の探索（本物のプラグインマーケットプレイスを構築する場合のみ）
- [ ] ランタイムロードのサードパーティプラグイン（admin UI install、S3 + 動的ロード）
- [ ] `privileged` プラグイン対応（プラグインごとの capabilities ベース動的 IAM プロビジョニング）
- [ ] プラグインマーケットプレイス（API + Web UI）
- [ ] WASM / quickjs-emscripten ランタイムサンドボックス

#### 一般機能の探索（trust とは独立）
- [ ] 管理画面からの Git 不要アップデート（エンジニア側の利便性）
- [ ] マルチ言語コンテンツ
- [ ] E コマース対応
