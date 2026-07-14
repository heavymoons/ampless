> 日本語版: [AI_FRIENDLY.ja.md](./AI_FRIENDLY.ja.md)
>

# AI-friendly CMS ideas

Status: partially adopted. The machine-readable exports subset — `/<slug>.md` (§3) and `/llms.txt` (§4) — plus a public read-only MCP endpoint has been adopted into the roadmap; see [14-roadmap.md § AI-readable publishing](./architecture/14-roadmap.md). The remaining sections stay unadopted proposals.

Last reviewed: 2026-07-14

This note collects product and architecture ideas for making ampless content easier for AI search, AI agents, and retrieval-augmented generation (RAG) systems to understand. JSON-LD is part of the story, but it should not be the whole story. A useful AI-friendly CMS should make the canonical content, metadata, relationships, freshness, rights, and operational policy explicit.

## Goals

- Help AI systems identify the canonical version of each page.
- Make article text, summaries, facts, media metadata, and references available without brittle HTML scraping.
- Give site owners control over crawler/search/training policy.
- Give editors feedback before publishing about what machines will read.
- Expose safe agent workflows for draft creation and content maintenance.

## Non-goals

- Promise ranking gains in AI search products. The ecosystem is too young and opaque for that.
- Treat `llms.txt` as a guaranteed standard. It is an emerging convention, not a W3C/IETF-level standard.
- Optimize only for LLM crawlers at the expense of normal web accessibility, SEO, and human readers.

## 1. Clean canonical HTML

Before adding AI-specific formats, public pages should already be easy to parse.

Recommended output:

- Server-rendered or statically generated article body that is present in initial HTML.
- Semantic landmarks: `main`, `article`, `header`, `footer`, `nav`.
- A single clear `h1`.
- Machine-readable dates via `time datetime`.
- Canonical URL with `<link rel="canonical">`.
- Language and alternate-language metadata with `html[lang]` and `hreflang` when applicable.
- Breadcrumbs and related links in predictable DOM regions.
- Clear separation between primary content, navigation, related content, ads, and decorative UI.

For ampless, this mostly belongs in `@ampless/runtime` and theme contracts. Themes should get helpers that make the correct structure the easy default.

## 2. Structured metadata beyond JSON-LD

JSON-LD should be generated automatically from first-class CMS fields, not handwritten per theme.

Suggested content fields:

- `summary`: short canonical summary for previews and AI answers.
- `keyFacts`: bullet-like factual claims extracted from the article.
- `faq`: question/answer pairs when the content naturally supports them.
- `author`, `reviewer`, `lastReviewedAt`.
- `sources`: canonical references with URL, title, publisher, and access date.
- `license`: reuse policy for the page.
- `audience`: optional hint such as `consumer`, `developer`, `medical-professional`, `internal`.
- `contentWarnings`: optional editorial flags.

Suggested generated schema:

- `Article` / `BlogPosting` for posts.
- `FAQPage` when FAQ items exist.
- `BreadcrumbList` for navigation.
- `Person` / `Organization` for authors and publishers.
- `ImageObject` / `VideoObject` for rich media.
- `Dataset` only when the page actually publishes dataset-like material.

Implementation note: generated structured data should only include facts visible to users on the page. Google's structured data guidelines treat misleading or hidden markup as a quality problem.

## 3. Machine-readable content endpoints

AI and RAG systems should not need to scrape theme HTML to find the article body.

Potential public endpoints:

- `/<slug>.md`: canonical Markdown projection of the post.
- `/<slug>.json`: normalized post JSON.
- `/content-index.json`: site-level index of canonical public content.
- `/collections/<name>.json`: collection-specific index.
- `/feed.xml` and `/feed.json`: RSS/Atom/JSON Feed style discovery.

Example `/<slug>.json` shape:

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

Access policy should be configurable. Some sites may want public JSON for everything; others may only expose Markdown/JSON for docs sections.

## 4. `llms.txt` and curated AI indexes

`llms.txt` is useful as a low-cost, human-readable and machine-readable map, but it should be presented as an emerging convention rather than a guaranteed crawler signal.

Potential generated files:

- `/llms.txt`: short curated map of the site.
- `/llms-full.txt`: optional larger Markdown bundle for documentation-style sites.
- `/content-index.json`: more stable structured index that ampless controls.

Recommended `llms.txt` contents:

- Site name and short description.
- Canonical sections.
- Most important docs/posts.
- Content that should be ignored by agents, such as tag archives or ephemeral landing pages.
- Contact or policy page.
- Links to Markdown/JSON content endpoints when enabled.

Do not use `llms.txt` as an access-control mechanism. Real access control still belongs in `robots.txt`, authentication, and server-side authorization.

## 5. Crawler and AI policy controls

Site owners need controls for search indexing, AI search retrieval, and model training. These are related but not identical.

CMS-level settings could generate:

- `robots.txt` rules.
- `X-Robots-Tag` headers for special routes.
- Per-page `robots` meta tags.
- A visible reuse/license policy.
- Optional AI crawler presets.

Useful policy presets:

| Preset | Search indexing | AI search retrieval | Model training |
| --- | --- | --- | --- |
| Open | Allow | Allow | Allow |
| Search only | Allow | Allow where supported | Disallow training crawlers |
| Human/public only | Allow normal search | Disallow known AI retrieval crawlers | Disallow training crawlers |
| Private/noindex | Disallow | Disallow | Disallow |

The exact crawler tokens change over time. As of 2026-05, relevant official references include OpenAI crawler docs and Google's crawler documentation, including `Google-Extended`.

## 6. Media readability

AI-friendly content is not only text.

Recommended CMS fields and checks:

- Required or strongly suggested `alt` text for meaningful images.
- Captions and credits.
- Transcript fields for audio/video.
- OCR text for PDFs and scanned images.
- License and attribution metadata per media item.
- Mark decorative images as decorative instead of forcing misleading alt text.

Admin UI should surface missing alt text, missing captions for important media, and media with unclear rights.

## 7. Entity and relationship model

AI systems handle content better when relationships are explicit.

Potential models or metadata:

- Authors and organizations.
- Products, projects, people, places, and events.
- Glossary terms.
- Synonyms and old names.
- Related posts and canonical internal references.
- `sameAs` links for well-known public entities.

This can start as optional metadata on posts, then become a richer entity registry if dogfooding shows demand.

## 8. Editor-facing AI preview

The admin UI should show what machines will see before publishing.

Potential checks:

- Generated JSON-LD preview and validation.
- Markdown/JSON endpoint preview.
- AI-readable summary preview.
- Missing canonical URL, summary, source, author, or reviewed date.
- Duplicate or conflicting slugs.
- Missing image alt text.
- Stale `lastReviewedAt`.
- "Likely answer" preview: how a generic AI assistant might summarize the page.

This should be framed as editorial QA, not as a promise of AI ranking.

## 9. Agent-safe CMS operations

For AI agents that operate the CMS, the important part is not only public readability. It is safe write workflow.

Recommended capabilities:

- Read-only content APIs for indexing and context.
- MCP tools with explicit scopes.
- Draft-first operations by default.
- Human approval for publish, delete, role changes, and token management.
- Diff preview for AI edits.
- Idempotency keys for write tools.
- Audit log for agent actions.
- Rollback or revision restore.
- Rate limits and token expiry.

Near-term ampless mapping:

- Keep MCP token issuance admin-only.
- Add per-token scopes before allowing broader automation.
- Prefer draft creation/update tools over direct publish tools.
- Record token prefix, actor, operation, target post, and timestamp in an audit log.

## Suggested roadmap

### Phase 1: Web and content basics

- Ensure semantic public HTML is consistent across first-party themes.
- Generate canonical, sitemap, RSS/Atom/JSON Feed, and `lastmod`.
- Add editor-approved `summary` and `sources` fields.
- Generate JSON-LD for posts, breadcrumbs, authors, and images.

### Phase 2: Machine-readable exports

- Add `/<slug>.md` and `/<slug>.json` for published posts.
- Add `/content-index.json`.
- Add `/llms.txt` as a curated map.
- Add per-site crawler policy settings.

### Phase 3: Editorial QA

- Add admin warnings for missing summary, sources, alt text, and stale reviewed dates.
- Add JSON-LD and machine-readable endpoint previews.
- Add optional AI summary/answer preview.

### Phase 4: Agent operations

- Add scoped MCP tokens.
- Add draft-first agent workflows.
- Add audit logs and rollback.
- Add approval gates for publish/delete/user/token actions.

## Open design questions

- Should Markdown/JSON endpoints be enabled by default, or opt-in per site?
- Should `summary`, `keyFacts`, and `sources` be first-class fields on `Post`, or plugin-managed metadata?
- Should AI crawler policy live in `cms.config.ts`, the admin UI, or both?
- How should static HTML bundles expose machine-readable metadata without requiring authors to edit bundle internals?
- What is the minimum useful audit log for agent actions before a full revision system exists?

## References

- Google Search Central: Structured data guidelines: https://developers.google.com/search/docs/appearance/structured-data/sd-policies
- Google Search Central: Structured data gallery: https://developers.google.com/search/docs/guides/search-gallery
- Google Search Central: robots.txt interpretation: https://developers.google.com/search/reference/robots_txt
- Google crawler documentation, including `Google-Extended`: https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
- OpenAI crawler documentation: https://platform.openai.com/docs/bots
- `llms.txt` reference note: https://llmtxt.info/
