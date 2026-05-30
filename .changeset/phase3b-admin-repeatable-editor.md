---
"@ampless/admin": minor
"ampless": patch
---

Adds `<RepeatableFieldEditor>` — admin UI for the `PluginRepeatableField`
type introduced in Phase 3b PR A. Plugins can now declare `type: 'repeatable'`
fields and have them rendered as an add/remove item list in `/admin/plugins`,
with each sub-field cell rendered by the existing scalar input components.

Changes:
- `renderScalarInput` extracted from `renderInput` (mechanical refactor,
  no behaviour change) so the new `case 'repeatable':` branch stays clean.
- `PluginRepeatableField` and `PluginRepeatableSubField` are now re-exported
  from the `ampless` package index (they were defined but not yet exported).
- Pure helper library `lib/repeatable-field.ts` with `parseRepeatableValue`,
  `serializeRepeatableValue`, `subFieldValueToFormString`,
  `formStringToSubFieldValue`, `makeEmptyItem`, `itemLabel`, `canAddItem`.
- 52 new unit tests covering all helpers (no jsdom required).
- `stringify` / `parse` in `plugin-settings-form.tsx` handle the repeatable
  case so the save path passes a typed array to `validatePluginSettingValue`.
