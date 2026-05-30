> English: [AI_FRIENDLY.md](./AI_FRIENDLY.md)
>

# AIフレンドリーCMS案

Status: proposal, not implemented.

Last reviewed: 2026-05-30

このメモは、ampless のコンテンツを AI 検索、AI エージェント、RAG（retrieval-augmented generation）システムから理解しやすくするためのプロダクト・アーキテクチャ案をまとめたもの。JSON-LD は重要だが、それだけでは足りない。AIフレンドリーなCMSでは、正規コンテンツ、メタデータ、関係性、鮮度、権利、運用ポリシーを明示できることが重要になる。

## 目的

- AIシステムが各ページの正規版を特定しやすくする。
- HTMLスクレイピングに頼らず、本文、要約、事実、メディア情報、出典を取得できるようにする。
- サイト運営者が crawler / search / training policy を制御できるようにする。
- 編集者が公開前に「機械からどう読まれるか」を確認できるようにする。
- AIエージェントによる下書き作成・保守作業を安全に扱えるようにする。

## 非目的

- AI検索でのランキング向上を約束すること。現時点のエコシステムは若く、不透明すぎる。
- `llms.txt` を確立済み標準として扱うこと。これは W3C / IETF レベルの標準ではなく、発展途上の慣習。
- 通常のWebアクセシビリティ、SEO、人間の読みやすさを犠牲にして LLM crawler だけに最適化すること。

## 1. 正規で読みやすいHTML

AI専用フォーマットを追加する前に、公開ページ自体が機械から読みやすい必要がある。

推奨出力:

- 初期HTMLに本文が含まれる server-rendered / statically generated な記事本文。
- `main`, `article`, `header`, `footer`, `nav` などの semantic landmarks。
- 明確な `h1` が1つ。
- `time datetime` による機械可読な日時。
- `<link rel="canonical">` による canonical URL。
- `html[lang]` と、必要に応じた `hreflang`。
- 予測可能なDOM領域にある breadcrumbs / related links。
- 主本文、ナビ、関連記事、広告、装飾UIの明確な分離。

ampless では主に `@ampless/runtime` と theme contract の責務。テーマが自然に正しい構造を出せる helper を提供するとよい。

## 2. JSON-LDを超えた構造化メタデータ

JSON-LD はテーマごとに手書きするのではなく、CMSの一級フィールドから自動生成する。

推奨コンテンツフィールド:

- `summary`: preview や AI answer に使える編集者承認済みの短い要約。
- `keyFacts`: 記事内の主要な事実主張。
- `faq`: 内容に自然に存在する Q&A。
- `author`, `reviewer`, `lastReviewedAt`。
- `sources`: URL、タイトル、発行元、参照日を持つ出典。
- `license`: ページの再利用ポリシー。
- `audience`: `consumer`, `developer`, `medical-professional`, `internal` などの任意ヒント。
- `contentWarnings`: 任意の編集上の注意フラグ。

生成候補の schema:

- 投稿には `Article` / `BlogPosting`。
- FAQ がある場合は `FAQPage`。
- ナビゲーションには `BreadcrumbList`。
- 著者・発行元には `Person` / `Organization`。
- リッチメディアには `ImageObject` / `VideoObject`。
- 実際に dataset 的な情報を公開するページのみ `Dataset`。

実装上の注意: structured data には、ユーザーにもページ上で見える事実だけを含める。Google の structured data guidelines では、ミスリーディングな markup や隠し markup は品質問題として扱われる。

## 3. 機械可読なコンテンツエンドポイント

AI や RAG システムがテーマHTMLをスクレイピングしなくても本文を取得できるようにする。

公開エンドポイント候補:

- `/<slug>.md`: 投稿の canonical Markdown projection。
- `/<slug>.json`: 正規化済み post JSON。
- `/content-index.json`: 公開コンテンツのサイト全体 index。
- `/collections/<name>.json`: collection 別 index。
- `/feed.xml` / `/feed.json`: RSS / Atom / JSON Feed 的な discovery。

`/<slug>.json` の例:

```json
{
  "url": "https://example.com/my-post",
  "canonicalUrl": "https://example.com/my-post",
  "title": "My Post",
  "summary": "A short editor-approved summary.",
  "format": "markdown",
  "bodyMarkdown": "...",
  "publishedAt": "2026-05-30T00:00:00.000Z",
  "updatedAt": "2026-05-30T00:00:00.000Z",
  "lastReviewedAt": "2026-05-30T00:00:00.000Z",
  "tags": ["cms", "ai"],
  "sources": [
    {
      "title": "Source title",
      "url": "https://example.org/source",
      "publisher": "Example Org"
    }
  ],
  "license": "https://creativecommons.org/licenses/by/4.0/"
}
```

公開ポリシーは設定可能にする。全記事のJSONを公開したいサイトもあれば、docs セクションだけに限定したいサイトもある。

## 4. `llms.txt` と curated AI index

`llms.txt` は低コストな、人間にも機械にも読めるサイトマップとして有用。ただし crawler が必ず見る保証のある signal ではなく、発展途上の慣習として扱う。

生成候補:

- `/llms.txt`: サイトの短い curated map。
- `/llms-full.txt`: docs 系サイト向けの大きめ Markdown bundle。
- `/content-index.json`: ampless が制御する、より安定した構造化 index。

推奨する `llms.txt` 内容:

- サイト名と短い説明。
- 正規セクション。
- 重要な docs / posts。
- tag archive や一時的な landing page など、agent が読まなくてよいコンテンツ。
- 問い合わせ先やポリシーページ。
- 有効化されている場合は Markdown / JSON content endpoints へのリンク。

`llms.txt` をアクセス制御として使わないこと。実際のアクセス制御は `robots.txt`、認証、サーバーサイド authorization の責務。

## 5. crawler と AI policy controls

サイト運営者は、検索 indexing、AI検索 retrieval、モデル training を分けて制御したい。これらは関連しているが同じものではない。

CMS設定から生成する候補:

- `robots.txt` rules。
- 特殊 route 向けの `X-Robots-Tag` headers。
- ページごとの `robots` meta tags。
- 表示可能な reuse / license policy。
- 任意の AI crawler presets。

policy preset 例:

| Preset | Search indexing | AI search retrieval | Model training |
| --- | --- | --- | --- |
| Open | Allow | Allow | Allow |
| Search only | Allow | 対応 crawler では Allow | training crawler は Disallow |
| Human/public only | 通常検索は Allow | 既知の AI retrieval crawler は Disallow | training crawler は Disallow |
| Private/noindex | Disallow | Disallow | Disallow |

crawler token は時間とともに変わる。2026-05時点では、OpenAI crawler docs と、`Google-Extended` を含む Google crawler documentation が重要な公式参照になる。

## 6. メディアの機械可読性

AIフレンドリーなコンテンツはテキストだけではない。

推奨CMSフィールド・チェック:

- 意味のある画像には `alt` text を必須または強く推奨。
- caption と credit。
- audio / video の transcript。
- PDF やスキャン画像の OCR text。
- メディア単位の license / attribution metadata。
- 装飾画像は、誤った alt text を強制せず decorative として扱う。

Admin UI では、alt text がない画像、重要メディアの caption 欠落、権利情報が曖昧なメディアを警告するとよい。

## 7. entity と relationship model

AIシステムは、関係性が明示されたコンテンツを扱いやすい。

モデルまたはメタデータ候補:

- 著者・組織。
- 製品、プロジェクト、人物、場所、イベント。
- 用語集。
- 同義語・旧称。
- 関連記事と正規の内部参照。
- 公開 entity に対する `sameAs` links。

まずは投稿の任意 metadata として始め、dogfooding で需要が見えたら richer entity registry に育てるのがよさそう。

## 8. 編集者向け AI preview

Admin UI で、公開前に「機械からどう見えるか」を確認できるようにする。

チェック候補:

- 生成される JSON-LD の preview / validation。
- Markdown / JSON endpoint preview。
- AI-readable summary preview。
- canonical URL、summary、source、author、reviewed date の欠落。
- 重複または衝突する slug。
- 画像 alt text 欠落。
- 古い `lastReviewedAt`。
- "Likely answer" preview: 一般的なAIアシスタントがそのページをどう要約しそうか。

これは AI ranking を約束する機能ではなく、編集QAとして見せる。

## 9. Agent-safe CMS operations

AIエージェントがCMSを操作する場合、公開ページの読みやすさだけでなく、安全な write workflow が重要になる。

推奨 capability:

- indexing / context 用の read-only content APIs。
- 明示的 scope を持つ MCP tools。
- 既定で draft-first operations。
- publish、delete、role change、token management は人間承認。
- AI編集の diff preview。
- write tools の idempotency keys。
- agent actions の audit log。
- rollback / revision restore。
- rate limit と token expiry。

ampless の近い対応:

- MCP token issuance は admin-only を維持。
- より広い自動化を許す前に per-token scopes を追加。
- 直接 publish より draft creation / update tools を優先。
- token prefix、actor、operation、target post、timestamp を audit log に記録。

## Suggested roadmap

### Phase 1: Web and content basics

- first-party theme 全体で semantic public HTML を揃える。
- canonical、sitemap、RSS/Atom/JSON Feed、`lastmod` を生成する。
- 編集者承認済みの `summary` と `sources` フィールドを追加する。
- 投稿、breadcrumbs、著者、画像の JSON-LD を生成する。

### Phase 2: Machine-readable exports

- 公開投稿に `/<slug>.md` と `/<slug>.json` を追加する。
- `/content-index.json` を追加する。
- curated map として `/llms.txt` を追加する。
- site 単位の crawler policy settings を追加する。

### Phase 3: Editorial QA

- summary、sources、alt text、古い reviewed date の欠落 warning を admin に追加する。
- JSON-LD と machine-readable endpoint の preview を追加する。
- 任意で AI summary / answer preview を追加する。

### Phase 4: Agent operations

- scoped MCP tokens を追加する。
- draft-first agent workflows を追加する。
- audit logs と rollback を追加する。
- publish / delete / user / token actions に approval gates を追加する。

## Open design questions

- Markdown / JSON endpoints は既定で有効にするか、site ごとの opt-in にするか。
- `summary`, `keyFacts`, `sources` は `Post` の一級フィールドにするか、plugin-managed metadata にするか。
- AI crawler policy は `cms.config.ts`、admin UI、またはその両方のどこに置くか。
- static HTML bundle は、作者が bundle 内部を編集しなくても machine-readable metadata をどう公開するか。
- full revision system の前に、agent actions の最小 audit log として何が必要か。

## References

- Google Search Central: Structured data guidelines: https://developers.google.com/search/docs/appearance/structured-data/sd-policies
- Google Search Central: Structured data gallery: https://developers.google.com/search/docs/guides/search-gallery
- Google Search Central: robots.txt interpretation: https://developers.google.com/search/reference/robots_txt
- Google crawler documentation, including `Google-Extended`: https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
- OpenAI crawler documentation: https://platform.openai.com/docs/bots
- `llms.txt` reference note: https://llmtxt.info/
