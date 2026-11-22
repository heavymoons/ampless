---
"ampless": minor
"@ampless/runtime": minor
"create-ampless": minor
---

Theme-declared custom classes for posts: manifest declaration and read-only rendering (heavymoons/ampless#411, first step of the reimplementation; refs #380).

- `ampless`: `ThemeCustomClassTarget` gains `'post'`, so a manifest can declare `{ id: 'wide', label: 'Wide', target: 'post' }`. New helpers `themeCustomClasses(manifest, target)`, `themePostClasses`, `postCustomClassName` (`ampless-post--<id>`), `readPostClasses`, `bypassesPostBodyWrapper` and `postBodyClassName(post, base)`. Post classes live under the namespaced metadata key `POST_CLASSES_METADATA_KEY` (`'ampless:postClasses'`) as a tagged `PostClassesMetadata` value, `{ kind: 'ampless.post-classes', version: 1, ids: [...] }`; anything else under that key is ignored. `themeTableClasses` behaves as before (still table entries only), so the admin table style menu never sees post entries.
- `@ampless/runtime`: `ampless.postBodyClassName(post, base)` returns `base` plus `ampless-post--<id>` for each valid id in the tagged value. It returns `base` unchanged for posts without it, so existing posts render byte-identical markup. Static posts and no_layout HTML posts (`format: 'html'` + `metadata.no_layout === true`, the middleware's own rule) never get post classes, even with the tagged value: their own URLs bypass the theme wrapper, and the home page featured slot leaves them unchanged too. Ids are re-validated on every call, so values written via MCP / GraphQL cannot break out of the `class` attribute.
- `create-ampless`: the bundled themes build their `#post-body` (and home featured-post body) class with `ampless.postBodyClassName`, keeping the same base classes as before. THEMES.md documents post and table classes.

Existing data is unaffected: `PostMetadata` gains no typed field (the new key stays `unknown` like any other free-form key), and a plain `metadata.postClasses` key — whatever a theme or plugin stored there — is neither read nor rendered.

This change only reads the tagged value. Nothing writes it yet: the admin editor, admin preview, MCP tools and static posts are unchanged and will follow in later steps.
