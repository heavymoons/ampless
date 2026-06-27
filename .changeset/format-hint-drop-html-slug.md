---
"@ampless/admin": patch
---

Remove the stale `.html` slug-suffix tip from the post editor's format hint. Bare-HTML rendering is now controlled by the `metadata.no_layout` toggle (already documented by the dedicated "No layout" checkbox hint), so the old slug-suffix wording was both inaccurate and redundant.
