---
"@ampless/plugin-gtm": patch
"@ampless/plugin-plausible": patch
"create-ampless": patch
---

Phase 3a plugin extension: add @ampless/plugin-gtm and
@ampless/plugin-plausible as new bundled untrusted plugins exercising
the Phase 1/2 descriptor + settings API. Both ship with admin-editable
settings (container ID / Plausible domain) so they can be configured
from /admin/plugins without redeploying. Adds the plugins to the
create-ampless scaffold defaults; activation requires registering in
cms.config.ts.
