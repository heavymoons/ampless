---
"ampless": minor
"@ampless/runtime": minor
"@ampless/plugin-analytics-ga4": patch
---

Phase 1 plugin extension: add descriptor-based head/body injection API to AmplessPlugin (`publicHead` / `publicBodyEnd`), with `capabilities` / `instanceId` / `displayName` fields. Runtime collects per-plugin descriptors, validates them (URL scheme denylist, attrs allowlist, inlineScript id required, duplicate id last-wins), and renders into the root layout as React elements. First bundled plugin: `@ampless/plugin-analytics-ga4` (untrusted, settings via cms.config.ts constructor args).
