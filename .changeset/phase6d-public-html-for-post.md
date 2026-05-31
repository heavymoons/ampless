---
"ampless": minor
"@ampless/runtime": minor
"create-ampless": patch
---

Phase 6d — `publicHtmlForPost` capability for server-side per-post
visible HTML.

Plugin authors now have a hydration-safe surface for emitting visible
HTML around a post body — reading-time badges, breadcrumbs, share
links, micro-format annotations, etc. The Phase 4 `publicBodyForPost`
surface is JSON-LD-only; Phase 5 prelude attempts to mutate visible
DOM from `publicHead` / `publicBodyEnd` inline scripts ran into
React 19 hydration mismatch and client-side `<script>` execution
refusal. Phase 6d adds a proper server-side aggregator.

**`ampless`** — new `PublicPostHtmlPosition` (`'beforeContent' |
'afterContent'`) and `PublicPostHtmlDescriptor` types; new
`AmplessPlugin.publicHtmlForPost?(post, ctx): readonly
PublicPostHtmlDescriptor[]` sync hook (same return-shape regime as
`publicBodyForPost`); new `'publicHtmlForPost'` capability.

**`@ampless/runtime`** — `ampless.publicHtmlForPost(post)` returns
`Promise<PublicHtmlForPostResult>` where each slot
(`beforeContent` / `afterContent`) is a `ReactNode | null`. The
runtime sanitizes every descriptor `body` under a strict
`sanitize-html` allowlist (tags: p / span / strong / em / a / code /
br / ul / ol / li; attributes: class / data-words / data-minutes /
`data-ampless-*`, plus a's href/rel/target; URL schemes:
http/https + relative + hash; `target="_blank"` triggers auto
`rel="noopener noreferrer"`). The same sanitize runs for every
`trust_level` — no pass-through escape hatch in v1. Descriptors carry
a plugin-local `id`; the runtime namespaces it to
`${instanceId ?? name}:${id}` for React keys and the wrapper
`<div>`'s `data-ampless-plugin` / `data-ampless-position` attributes.
Dedupe is per-position (same id allowed across both slots; duplicates
within a single position keep the first occurrence and warn).
Capability-vs-implementation mismatch warns at startup.

**`create-ampless`** — the six bundled themes' `pages/post.tsx`
(blog / corporate / dads / docs / landing / minimal) now embed
`{html.beforeContent}` and `{html.afterContent}` around the post
body. Themes never call `dangerouslySetInnerHTML` on plugin output;
the runtime owns sanitize / wrap / dedupe.

A reference plugin (`@ampless/plugin-reading-time`) and template
seeding for it ship in a follow-up PR.
