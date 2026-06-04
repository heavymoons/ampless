---
"ampless": minor
"@ampless/backend": minor
"create-ampless": patch
---

Make `trust_level: 'privileged'` plugins visible (Phase 1 reservation).

The `'privileged'` trust level has been in the TrustLevel type union
as a reserved value with no provisioned Lambda. Plugins that declared
it were silently dropped by both event processors — event hooks
never ran, no warning was logged, and plugin authors had no signal.
Sync render surfaces (publicHead / metadata / publicBodyForPost /
publicHtmlForPost) continued to work because they don't gate on
trust_level.

This patch keeps the runtime behaviour (hooks are still not executed
at the privileged tier — that needs the future privileged Lambda
provisioning PR) but adds three layers of visibility:

- `definePlugin()` console.warn when a plugin declares
  `trust_level: 'privileged'` together with `hooks` or
  `capabilities: ['eventHooks']`. Fires at every module load
  (Lambda cold start, `next dev` start, vitest run).
- Both event processors (trusted and untrusted) console.warn when
  an arriving SQS event matches a hook declared by a privileged
  plugin. Emitted twice per event by design (once per processor),
  so the duplication itself signals that the plugin's hooks are
  being filtered out by every dispatcher path. The untrusted
  processor's existing `if (untrustedPlugins.length === 0) return`
  early-exit is broadened to also account for `privilegedHookedPlugins`
  so that a configuration with only privileged plugins still emits
  the warning (the prior version would have bailed out before reaching
  the scan).
- Architecture doc and plugin-author guide both updated to state
  explicitly that event hooks at `'privileged'` do not execute
  today; the contract remains "reserved tier, type accepts it,
  sync surfaces work, hooks don't until the privileged Lambda is
  provisioned".

No throw, no behavior fallback to `'trusted'` — the runtime
behaviour around hooks is unchanged. This is a fail-closed
visibility patch, not a functional change. When the privileged
Lambda provisioning PR lands, plugins that declared `'privileged'`
today will automatically pick up the new privilege tier; nothing
needs to change in their code.
