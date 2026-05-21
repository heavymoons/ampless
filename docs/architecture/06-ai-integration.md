> 日本語版: [06-ai-integration.ja.md](./06-ai-integration.ja.md)
> 
## 6. AI Integration

### Design Philosophy

All AI features are **provided as plugins**; the core only holds shared infrastructure — side panel slots, editor operation APIs, and diff preview UI.
Provider abstraction is handled at the plugin layer (the layer that contains AI logic), so the core has no dependency on any AI stack.

The standard stack is **Amplify AI Kit + Bedrock + Claude (Haiku by default)**, capturing the benefits of staying fully within AWS: no API key management, Cognito auth integration.
For advanced UX that requires client-side tools, or to use a provider not supported by Bedrock (e.g., Gemini), swap in a different plugin.

### Provider Strategy

| Use case | Standard choice | Swap-in options |
|----------|----------------|----------------|
| Editing assistance chat (proofreading, editing suggestions) | Amplify AI Kit + Bedrock + Claude Haiku | Vercel AI SDK plugin (when client-side tools are needed) |
| Inline translation on display (on-the-fly) | Bedrock + Claude Haiku | Gemini Flash plugin (for cost optimization) |
| Lightweight tasks: image ALT generation, summarization, tag suggestions | Bedrock + Claude Haiku | Same as above |

Reasons for choosing Amplify AI Kit as the standard:

- Auth, streaming, conversation persistence, and tool-use loops are built in
- No API key management (Lambda execution role calls Bedrock via IAM)
- Fully within AWS = data never leaves AWS (attractive for compliance-sensitive users)
- For batch publishing and low-frequency workloads, Bedrock's downsides (slightly delayed model availability, marginally higher cost/latency vs. direct API) are negligible

Constraints when not using Amplify AI Kit:

- Tool execution is server-side (Lambda) only → **client-side tools such as editor patches cannot be composed with AI Kit** (worked around by returning a proposal JSON for the front end to apply)
- Provider is locked to Bedrock → swap to a different plugin for Gemini or Anthropic direct API
- Conversation history is persisted to DynamoDB (set a TTL if used only as session-scoped working memory)

### What the Core Provides (admin core)

The admin core provides the following as an extension foundation for AI plugins:

#### 1. Side Panel Slot

A collapsible side panel to the right of the edit form (default width 360–400 px).
A single slot renders exactly one plugin (the UX of showing multiple AI plugins side-by-side is not provided in v1).

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

#### 3. Diff Preview UI

Renders a red/green inline diff inside the editor using Tiptap decorations, with per-chunk accept/reject UI.
Centralized in the core to avoid inconsistent UX if each plugin implements it independently.

#### 4. Plugin Contract

```typescript
interface EditAssistantPlugin {
  id: string                    // e.g. 'ai-assistant'
  label: string                 // e.g. 'Edit Assistant'
  icon: ComponentType
  render(ctx: {
    editor: EditorContext
    patch: EditorPatch
    site: SiteContext
  }): ReactNode
}
```

Enable exactly one in `cms.config.ts`:

```typescript
plugins: [
  amplessAiAssistant({
    provider: 'amplify-ai-kit',
    tools: ['web_search', 'fetch_url', 'search_internal_posts'],
    webSearch: { backend: 'tavily', apiKey: env.TAVILY_API_KEY },
  }),
]
```

### `@ampless/plugin-ai-assistant` (Standard: Editing Assistance Chat)

Consolidates proofreading, editing, revision suggestions, and fact-checking into **a single chat interface**.
No separate "Fact Check" tab or "Proofreading" tab. In a real editing workflow, "is this sentence accurate?" and "give me a rephrasing" come up back-to-back, so consolidating them into a tool-equipped agentic chat is the natural approach.

#### Exposed Tools

Tools are split into a **default set that works without API keys** and an **extended set enabled by API key configuration**.
Without any key configured, fact-checking still works for "verify by providing a URL directly" and "verify facts available on Wikipedia/Wikidata."
Tavily / Brave API keys are only needed for free-form web search.

| Tool | Execution | Auth | Purpose |
|------|-----------|------|---------|
| `fetch_url` | Lambda (UA-spoofed GET) | No key | Fetch page body from a given URL (verify citations, validate known URLs) |
| `wikipedia_search` | Lambda (Wikipedia REST API) | No key | Search for people, events, places, history, basic statistics |
| `wikidata_query` | Lambda (Wikidata SPARQL) | No key | Verify structured facts (birth/death dates, population, GDP, etc.) |
| `search_internal_posts` | Lambda (via AppSync) | No key | Semantic search of past posts on the same site (self-citation consistency, duplicate topic check) |
| `web_search` | Lambda (external search API) | **API key required** | Free-form web search for information not on Wikipedia |
| `apply_edit` | Front end (proposal extraction) | No key | Replace a specified range in the body with proposed text (via diff preview) |

Due to AI Kit's server-side tool constraints, `apply_edit` cannot be implemented as a pure tool.
Instead, **structured edit proposal JSON (e.g., `<suggestion from="..." to="..." new_text="..."/>`) is embedded in the LLM's response, then extracted on the front end and passed to the diff preview UI**.

#### System Prompt Policy

The LLM is instructed to **"use Wikipedia/Wikidata first; for facts not found there, use `web_search` if available; if not available, state that explicitly and flag the item as 'needs verification.'"**
This ensures honest behavior even without any API keys configured ("say when you don't know").

#### Web Search Backends (only when API key is configured)

Swappable via `webSearch.backend`. **If not configured, the `web_search` tool is not offered to the AI at all** (the LLM recognizes "free-form web search is unavailable"):

| Backend | Characteristics | Cost estimate |
|---------|----------------|--------------|
| `tavily` | Designed for AI agents; results in LLM-friendly format | ~$0.005/req (1,000 req/month free tier) |
| `brave` | Independent crawler, commercial use allowed | $3/1,000 req |
| `anthropic-native` | Only when using Anthropic direct API; search executed server-side | $10/1,000 req |

The standard backends distributed with ampless are Tavily (ease of use + cost) and Brave (lowest cost).

#### Keyless Operation Trade-offs

Incorporating scraping-based approaches like DuckDuckGo HTML as "keyless web search" has been considered, but
**ToS gray area, future IP-ban risk, and parse-breakage risk** are not the right burden for the ampless core to carry.
That space is left for users to implement as external plugins (`@ampless/web-search-tool-ddg` etc. as third-party plugins).
The officially distributed standard stack draws the line at: "keyless = Wikipedia + URL fetch; free search = API key required."

#### UI Pattern

Chat UI inside the side panel, with tool execution visualized:

```
You: I wrote "GDP growth rate was 3.2% in 2024" — is that right?

AI: Let me verify.
   Search web_search: "2024 Japan GDP growth rate Cabinet Office"
      → Cabinet Office (cao.go.jp): 0.9% (2024 real GDP)
      → Nikkei: 0.9% confirmed

   The figure you stated differs significantly from the actual value.
   The Cabinet Office reports 2024 real GDP growth at 0.9%.

You: Please fix it

AI: Suggestion: "3.2%" → "0.9% (Cabinet Office, real GDP)"
   [Preview: red/green diff] [Accept] [Reject]
```

Tool calls are shown collapsed. Chat history lives only in component state (treated as session-scoped working memory; DynamoDB persistence is off by default).

#### Report Mode (optional)

"Full fact-check before publishing" works with the same tool set:

- Send the same tool-equipped Claude a system prompt to "scan the full text and list items needing verification"
- Results are displayed as a report; each finding has a "discuss in chat" button to return to normal mode

### `@ampless/plugin-ai-inline-translate` (Optional: Multilingual Inline Translation)

Same philosophy as X / Twitter's auto-translation. **Translates on the fly at display time based on the reader's browser language**, caching in CDN or KvStore.
No schema changes required; no core changes needed. On/off with a single plugin.

#### Flow

1. At request time, the theme detects `Accept-Language` → if different from the original language, calls the plugin API
2. Check KvStore cache with `pk: translation:{siteId}:{postId}:{contentHash}`, `sk: {targetLang}`
3. Cache hit → return translated JSON (a few ms)
4. Cache miss → send to Bedrock + Claude Haiku for translation → save to KvStore (TTL 30 days default) → return
5. Theme renders the translated version; displays a "Machine translated (Original: Japanese)" badge + link to original at the top

By including `contentHash` in the key, translation cache is automatically invalidated when the original is updated (old hashes expire via TTL).

#### Configuration

```typescript
plugins: [
  amplessInlineTranslate({
    enabled: true,
    provider: 'bedrock-claude-haiku',
    targetLanguages: ['en', 'zh', 'ko'],  // translate only these; others return original
    cacheTtlDays: 30,
    showBadge: true,
    fallbackToOriginal: true,
  }),
]
```

#### Cost Estimate

- ~$0.005 / language per ~5,000-character article with Claude Haiku
- Even a site with 1,000 monthly page views would cost only a few cents

#### SEO Note

- Serving different content per `Accept-Language` on a single URL is a weaker SEO strategy than `hreflang` with separate URLs
- Declare the original as canonical with `<link rel="alternate" hreflang="x-default">` and serve translated pages with `noindex`
- Indexing machine-translated pages under separate URLs carries Google quality risk, so this is an intentional choice

### Multilingual Data Design (not in v1)

When demand emerges to **publish translations as first-class content** (reviewed by editors, served under separate URLs for SEO), add the following to the Post schema.
In v1, use the inline translation plugin as a substitute and do not touch the core schema.

```typescript
Post: a.model({
  // existing fields ...
  lang: a.string(),              // 'ja' | 'en' | ... ; null means site primary lang
  translationOf: a.id(),         // postId of original (null for originals)
  siteIdLangStatus: a.string(),  // `${siteId}#${lang}#${status}`
  siteIdLangSlug: a.string(),    // `${siteId}#${lang}#${slug}`
})
.secondaryIndexes((index) => [
  index('siteIdLangStatus').sortKeys(['publishedAt']).name('bySiteIdLangStatus'),
  index('siteIdLangSlug').name('bySiteIdLangSlug'),
  index('translationOf').name('byTranslationOf'),
])
```

The old `siteIdStatus` / `siteIdSlug` GSIs are retained for single-language site compatibility; treating `lang` as absent = primary lang allows existing sites to run without modification.
Pages follow the same shape.

Reasons for deferring to post-v1:

- WordPress Polylang/WPML-style "translation-as-sibling-post" demand is limited for personal blogs
- Inline translation (X-style) expands reach with zero burden on publishers
- Adding GSIs + backfilling later is possible (not impossible)

For WordPress compatibility scope, Polylang data import may be done in the future, so the shape of `lang` / `translationOf` is determined now (implementation deferred).

### Other AI Plugin Candidates

Once the editing assistance chat foundation (side panel + EditorContext + diff preview) is in place, the following fit within the same framework:

| Plugin | Integration point | Feature |
|--------|------------------|---------|
| `@ampless/plugin-ai-tags` | In editing chat or `after:content.updated` | Tag and category suggestions |
| `@ampless/plugin-ai-summary` | `after:content.updated` | Auto-generate summary and meta description |
| `@ampless/plugin-ai-ogp` | `after:content.published` | Generate OGP text |
| `@ampless/plugin-ai-alt-text` | `after:media.uploaded` | Auto-generate image ALT text |
| `@ampless/plugin-ai-translate-draft` | Edit view (after sibling Post design is in) | Generate translation draft → editor review → publish |

### Implementation Order

1. **admin core**: side panel slot + EditorContext / EditorPatch API + diff preview UI (build the shell first, working without AI)
2. **`@ampless/plugin-ai-assistant` MVP**: chat + Bedrock Claude Haiku, no tools, proposal extraction → diff apply only
3. **Add keyless tools**: `fetch_url` (UA-spoofed GET) + `wikipedia_search` + `wikidata_query` (Wikipedia REST / SPARQL) → keyless fact-checking experience complete
4. **Add `search_internal_posts` tool**: semantic search of existing posts (past article consistency check)
5. **Add `web_search` tool (optional)**: Tavily / Brave backend support, enabled only when API key is configured
6. **`@ampless/plugin-ai-inline-translate`**: X-style on-the-fly translation (no schema changes)
7. **`@ampless/plugin-ai-tags` / `-summary` / `-alt-text`**: add within the same framework once the editing assistance pattern is established
8. **Multilingual data design (sibling Posts)**: introduce when translation publishing is needed for first-party sites

### v1 Policy

- v0.x: admin core common infrastructure + `@ampless/plugin-ai-assistant` (editing assistance chat) MVP
- v0.x: `@ampless/plugin-ai-inline-translate` (X-style inline translation)
- v1.0: Both plugins stable + web search tool integrated
- Post-v1.0: Tag suggestion, summarization, ALT text generation plugins added incrementally
- Post-v1.0 (demand-dependent): Sibling Post multilingual data design + translation draft plugin

---
