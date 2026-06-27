---
"@ampless/admin": patch
"@ampless/mcp-server": patch
---

Fix several data-staleness / error-swallowing issues in the post editor and static-bundle paths.

- **admin**: editing a post and clearing `excerpt` or unchecking the `no_layout` toggle now actually clears the stored value. The full-document save was passing `undefined`, which `provider.update` omits as a partial-patch no-op, so the old value survived.
- **admin**: `EditPostPage` now `.catch`es the post fetch (previously `.then().finally()` with no catch) — a load failure renders a `common.loadError` message instead of an unhandled rejection that strands the page on the loading state. Adds the `common.loadError` key (en/ja).
- **admin**: `uploadBundle` no longer swallows a failed pre-upload `deleteBundle`; a genuine S3 failure is logged and rethrown so removed files can't silently survive the replace.
- **admin**: extracted `renderScalarInput` into `scalar-input.tsx` to break the `plugin-settings-form` ↔ `repeatable-field-editor` import cycle (internal refactor, no API change).
- **mcp-server**: `upload_static_bundle` rethrows on `listObjects` failure instead of proceeding with `[]`, which would leave stale files and violate the full-prefix-wipe contract.
- **mcp-server**: `get_schema` now includes `static` in the post `format` enum and the top-level `formats` list (with a note that it is read-only via the static-bundle tools), so the schema matches what `get_post` / `list_posts` can actually return.
