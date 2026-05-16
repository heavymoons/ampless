## 6. AI 連携

### 設計思想

AI 機能は **すべてプラグインとして提供** し、コアは「サイドパネルスロット」「エディタ操作 API」「diff プレビュー UI」など共通基盤だけを持つ。
プロバイダ抽象は AI 機能の中身を持つレイヤー（プラグイン）側で吸収し、コアは AI スタックそのものに依存しない。

標準スタックは **Amplify AI Kit + Bedrock + Claude（Haiku 既定）** とし、AWS 完結・APIキー管理不要・Cognito 認証統合のメリットを取る。
クライアントサイドツールが必要な高度な UX や、Bedrock 非対応プロバイダ（Gemini 等）を使いたい場合は、プラグイン差し替えで対応する。

### プロバイダ戦略

| 用途 | 標準採用 | 差し替え選択肢 |
|------|---------|---------------|
| 編集支援チャット（校正・校閲・修正提案） | Amplify AI Kit + Bedrock + Claude Haiku | Vercel AI SDK 版プラグイン（client-side tool が要るとき） |
| インライン翻訳（表示時オンザフライ） | Bedrock + Claude Haiku | Gemini Flash プラグイン（コスト最適化したいとき） |
| 画像 ALT 生成・要約・タグ提案など軽量タスク | Bedrock + Claude Haiku | 同上 |

Amplify AI Kit を標準にする理由:

- 認証・ストリーミング・会話永続化・ツール use ループが標準装備
- API キー管理不要（Lambda 実行ロールから IAM で Bedrock 呼び出し）
- AWS 完結 = データが AWS 外に出ない（コンプライアンス要件のある利用者にも刺さる）
- 投稿時バッチ処理・低頻度ワークロードでは Bedrock のデメリット（最新モデル反映遅延・直 API より少し高い・少し遅い）が実質的に効かない

Amplify AI Kit を採用しない場合の制約:

- ツール実行は Lambda サーバーサイド固定 → エディタ patch のような **クライアントサイドツールは AI Kit では組めない**（提案 JSON を返してフロント側で適用するパターンで回避）
- プロバイダは Bedrock 固定 → Gemini/Anthropic 直 API を使いたい場合は別プラグインに差し替え
- 会話履歴は DynamoDB に永続化される（編集セッション限定の作業記憶として使う場合は TTL 設定）

### コアが提供するもの（admin core）

AI プラグインの拡張基盤として、admin core に以下を入れる:

#### 1. サイドパネルスロット

編集フォーム右側に折りたたみ可能なサイドパネル（既定幅 360-400px）。
プラグイン 1 個だけを render する単一スロット（複数 AI プラグインを並べる UX は v1 では提供しない）。

#### 2. EditorContext / EditorPatch API

```typescript
interface EditorContext {
  getBody(): TiptapJSON
  getSelection(): { from: number; to: number; text: string } | null
  getTitle(): string
  getMeta(): { tags: string[]; excerpt: string; ... }
  onChange(cb: (body: TiptapJSON) => void): Unsubscribe
}

interface EditorPatch {
  replaceSelection(text: string): void
  replaceRange(from: number, to: number, text: string): void
  replaceBody(json: TiptapJSON): void
  showDiffPreview(operations: DiffOp[]): Promise<'accepted' | 'rejected'>
}
```

#### 3. Diff プレビュー UI

エディタ内に red/green の inline diff を Tiptap decoration で描画し、chunk 単位で accept/reject できる UI。
プラグイン側で実装させると UX がバラバラになるため、コアに集約する。

#### 4. プラグイン契約

```typescript
interface EditAssistantPlugin {
  id: string                    // 例: 'ai-assistant'
  label: string                 // 例: '編集支援'
  icon: ComponentType
  render(ctx: {
    editor: EditorContext
    patch: EditorPatch
    site: SiteContext
  }): ReactNode
}
```

`cms.config.ts` で 1 個だけ enabled にする:

```typescript
plugins: [
  amplessAiAssistant({
    provider: 'amplify-ai-kit',
    tools: ['web_search', 'fetch_url', 'search_internal_posts'],
    webSearch: { backend: 'tavily', apiKey: env.TAVILY_API_KEY },
  }),
]
```

### `@ampless/plugin-ai-assistant`（標準: 編集支援チャット）

校正・校閲・修正提案・ファクトチェックを **1 つのチャットに統合** する。
独立した「ファクトチェック」タブ・「校正」タブには分けない。実際の編集ワークフローでは「この一文怪しいけど合ってる？」と「言い換え案ちょうだい」が連続して出るため、ツール持ったエージェント的チャットに集約する方が自然。

#### 公開ツール

ツールは **API キー不要で動く既定セット** と、**API キー設定で有効化される拡張セット** に分かれる。
キー設定なしの素の状態でもファクトチェックは「URL を直接渡しての検証」と「Wikipedia/Wikidata に載っている事実の検証」が可能。
自由な web 検索が必要な場合のみ Tavily / Brave の API キーを設定する。

| ツール | 実行場所 | 認証 | 用途 |
|-------|---------|------|------|
| `fetch_url` | Lambda（UA 偽装 GET） | キー不要 | URL を指定しての本文取得（引用元確認・既知 URL の検証） |
| `wikipedia_search` | Lambda（Wikipedia REST API） | キー不要 | 人物・出来事・地名・歴史・基本統計の検索 |
| `wikidata_query` | Lambda（Wikidata SPARQL） | キー不要 | 構造化された事実（生没年・人口・GDP 等）の確認 |
| `search_internal_posts` | Lambda（AppSync 経由） | キー不要 | 同サイトの過去投稿を意味検索（自己引用整合性・既出ネタ確認） |
| `web_search` | Lambda（外部検索 API） | **API キー要** | Wikipedia に無い情報の自由な web 検索 |
| `apply_edit` | フロント（提案返却 → 抽出） | キー不要 | 本文の指定範囲を提案テキストで置換（diff プレビュー経由） |

`apply_edit` は AI Kit のサーバーサイドツール制約上、純粋なツールとして組めないため、
**LLM のレスポンスに構造化された編集提案 JSON（`<suggestion from="..." to="..." new_text="..."/>` 等）を埋めて、フロント側で抽出 → diff プレビュー UI に渡す** パターンで実装する。

#### システムプロンプトの方針

LLM には **「Wikipedia/Wikidata を最優先で使い、見つからない事実は `web_search` が利用可能ならそちらで、不可ならその旨明記して『要確認』フラグを立てる」** と指示する。
これにより API キー無し設定でも誠実な挙動（「分からないものは分からないと言う」）になる。

#### Web 検索バックエンド（API キー設定時のみ）

`webSearch.backend` で差し替え可能。**未設定の場合は `web_search` ツール自体が AI に提示されない**（「自由な web 検索は使えない」状態として LLM 側で認識される）:

| バックエンド | 特徴 | コスト目安 |
|------------|------|-----------|
| `tavily` | AI エージェント向け設計、結果が LLM に食わせやすい形式 | $0.005/req〜（月 1000req 無料枠） |
| `brave` | 独立クローラ、商用利用可 | $3/1000req |
| `anthropic-native` | Anthropic 直 API 経由のとき限定、サーバー側で検索実行 | $10/1000req |

ampless 側で配布する標準バックエンドは Tavily（手軽さ + コスト）と Brave（最安）。

#### キーレス運用での割り切り

DuckDuckGo HTML 版等のスクレイピング系を「キー不要の web 検索」として組み込む案もあるが、
**ToS グレーゾーン・将来 IP ブロックされるリスク・パース壊れリスク** を ampless コアが背負うのは筋が悪い。
そこは利用者の判断で外部プラグイン（`@ampless/web-search-tool-ddg` 等のサードパーティ）として実装する余地を残し、
公式配布の標準スタックは「キーレスは Wikipedia + URL 取得まで、自由検索は API キー」という線引きにする。

#### UI パターン

サイドパネル内のチャット UI で、ツール実行を可視化する:

```
👤 「2024年のGDP成長率は3.2%」って書いたけど合ってる？

🤖 確認します。
   🔍 web_search: "2024 日本 GDP成長率 内閣府"
      → 内閣府 (cao.go.jp): 0.9% (2024年実質GDP)
      → 日経新聞: 0.9% で確認

   ご指摘の数値は実際の値と大きく異なります。内閣府発表では
   2024年実質GDP成長率は 0.9% です。

👤 修正お願い

🤖 🔧 提案: 「3.2%」→「0.9%（内閣府発表、実質GDP）」
   [プレビュー: red/green diff] [承認] [却下]
```

ツール呼び出しは折りたたみ表示。チャット履歴はコンポーネント state のみ（編集セッション限定の作業記憶として割り切り、DynamoDB 永続化は既定で off）。

#### レポートモード（オプション）

「公開前に全文ファクトチェック一括」も同じツール群で:

- 同じツール持った Claude に「全文スキャンして要確認箇所を列挙」というシステムプロンプトで投げる
- 結果はレポート形式で表示、各指摘から「チャットで詳細議論する」ボタンで通常モードに戻る

### `@ampless/plugin-ai-inline-translate`（オプション: 多言語インライン翻訳）

X / Twitter の自動翻訳と同じ思想。**読み手のブラウザ言語に応じて表示時にオンザフライ翻訳** し、CDN や KvStore にキャッシュする。
スキーマ変更不要、コアタッチ不要。プラグイン 1 個でオン/オフ可能。

#### 動作フロー

1. リクエスト時にテーマが `Accept-Language` を検出 → 原文と異なる言語ならプラグイン API を呼ぶ
2. `KvStore` を `pk: translation:{siteId}:{postId}:{contentHash}`, `sk: {targetLang}` でキャッシュ確認
3. キャッシュヒット → 翻訳済 JSON を返す（数 ms）
4. キャッシュミス → Bedrock + Claude Haiku に翻訳投げる → KvStore に保存（TTL 30日 既定）→ 返す
5. テーマは翻訳版を表示し、上部に「機械翻訳されたものです（原文：日本語）」バッジ + 原文切替リンクを描画

`contentHash` をキーに含めることで、原文更新時に自動で翻訳キャッシュが無効化される（古いハッシュは TTL で消える）。

#### 設定

```typescript
plugins: [
  amplessInlineTranslate({
    enabled: true,
    provider: 'bedrock-claude-haiku',
    targetLanguages: ['en', 'zh', 'ko'],  // この言語のみ翻訳、それ以外は原文返す
    cacheTtlDays: 30,
    showBadge: true,
    fallbackToOriginal: true,
  }),
]
```

#### コスト試算

- Claude Haiku で 1 記事 5000 字 ≈ $0.005 / 言語
- 月 1000 PV のサイトでも数十セント程度

#### SEO 上の注意

- 単一 URL で `Accept-Language` 出し分けは別 URL での hreflang 戦略より弱い
- `<link rel="alternate" hreflang="x-default">` で原文を正規版として明示し、翻訳版は `noindex` で配信
- 機械翻訳ページを別 URL でインデックスさせると Google 評価リスクがあるため、これは意図的な選択

### 多言語データ設計（v1 では入れない）

**翻訳版を一級コンテンツとして編集者がレビューして公開・別 URL で SEO を取りに行く** 需要が出てきた段階で、Post スキーマに以下を追加する。
v1 ではインライン翻訳プラグインで代替し、コアスキーマには触らない。

```typescript
Post: a.model({
  // 既存 ...
  lang: a.string(),              // 'ja' | 'en' | ... 未指定はサイト primary lang
  translationOf: a.id(),         // 原文 postId（原文自身は null）
  siteIdLangStatus: a.string(),  // `${siteId}#${lang}#${status}`
  siteIdLangSlug: a.string(),    // `${siteId}#${lang}#${slug}`
})
.secondaryIndexes((index) => [
  index('siteIdLangStatus').sortKeys(['publishedAt']).name('bySiteIdLangStatus'),
  index('siteIdLangSlug').name('bySiteIdLangSlug'),
  index('translationOf').name('byTranslationOf'),
])
```

旧 `siteIdStatus` / `siteIdSlug` GSI は単一言語サイト互換のため残し、`lang` 未指定 = primary lang として扱えば既存サイトを無改変で動かせる。
Page も同形で揃える。

導入タイミングを v1 後送りにする理由:

- WordPress Polylang/WPML 風の「翻訳版＝兄弟 Post」需要は個人ブログ層では限定的
- インライン翻訳（X 方式）の方が出版者負担ゼロでリーチ拡大できる
- 後から GSI 追加 + バックフィルは可能（不可能ではない）

WordPress 互換性スコープ的には Polylang データ取り込みを将来やる可能性があるため、`lang` / `translationOf` の形は今のうちに決めておく（実装は後送り）。

### その他の AI プラグイン候補

編集支援チャットの基盤（サイドパネル + EditorContext + Diff プレビュー）が整えば、以下は同枠組みに乗る:

| プラグイン | 連携点 | 機能 |
|-----------|-------|------|
| `@ampless/plugin-ai-tags` | 編集支援チャット内 or after:content.updated | タグ・カテゴリ提案 |
| `@ampless/plugin-ai-summary` | after:content.updated | 要約・メタディスクリプション自動生成 |
| `@ampless/plugin-ai-ogp` | after:content.published | OGP テキスト生成 |
| `@ampless/plugin-ai-alt-text` | after:media.uploaded | 画像 ALT テキスト自動生成 |
| `@ampless/plugin-ai-translate-draft` | 編集画面（兄弟 Post 設計入った後） | 翻訳「下訳」生成 → 編集者レビュー → 公開 |

### 実装順序

1. **admin core**: サイドパネルスロット + EditorContext / EditorPatch API + Diff プレビュー UI（AI 抜きで動く箱を先に作る）
2. **`@ampless/plugin-ai-assistant` MVP**: chat + Bedrock Claude Haiku、ツール無し、提案抽出 → diff 適用だけ
3. **キーレスツール群追加**: `fetch_url`（UA 偽装 GET）+ `wikipedia_search` + `wikidata_query`（Wikipedia REST / SPARQL）→ ここまでで API キー無しのファクトチェック体験完成
4. **`search_internal_posts` ツール追加**: 既存投稿の意味検索（過去記事整合性チェック）
5. **`web_search` ツール追加（オプショナル）**: Tavily / Brave バックエンド対応、API キー設定時のみ有効化
6. **`@ampless/plugin-ai-inline-translate`**: X 方式オンザフライ翻訳（スキーマ無変更）
7. **`@ampless/plugin-ai-tags` / `-summary` / `-alt-text`**: 編集支援パターン確立後に同枠組みで追加
8. **多言語データ設計（兄弟 Post）**: ファーストパーティサイトで翻訳版運用が必要になったら導入

### v1 方針

- v0.x: admin core 共通基盤 + `@ampless/plugin-ai-assistant`（編集支援チャット） MVP
- v0.x: `@ampless/plugin-ai-inline-translate`（X 方式インライン翻訳）
- v1.0: 上記 2 プラグインが安定動作 + Web 検索ツール統合済み
- v1.0 後: タグ提案・要約・ALT 生成プラグインを順次追加
- v1.0 後（需要次第）: 兄弟 Post 多言語データ設計 + 翻訳下訳プラグイン

---
