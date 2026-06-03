---
"ampless": minor
"@ampless/runtime": minor
---

Reserve API surface for CSP nonce propagation (Phase 1 no-op).

- PluginCapability union: name-only 'cspReady' added (Reserved
  section, no runtime cross-check today).
- PluginPublicRenderContext: cspNonce?: string reserved on the
  interface. The runtime does not populate it yet; reads resolve
  to undefined. Middleware/SSR threading lands with the future
  CSP RFP.
- inlineScript variant: existing nonce?: string field gains a
  documented 'auto' sentinel for future runtime stamping. No
  TypeScript breaking change (string union already accepted 'auto'
  as a literal).
- script (external src) variant: new nonce?: 'auto' | string
  field, symmetric reservation with inlineScript.

Runtime behaviour does not change in this release. Both `attrs.nonce`
denial (security boundary preserved) and the existing nonce-drop
regression test remain in place.

Plugin authors can declare `nonce: 'auto'` today; once the
middleware-driven nonce threading PR lands, plugin-supplied scripts
will become candidates for runtime nonce stamping (site-level CSP
compliance still depends on middleware / response headers / other
inline content the runtime does not control).
