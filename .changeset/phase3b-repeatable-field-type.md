---
"ampless": minor
"@ampless/admin": patch
---

Adds `PluginRepeatableField` and `PluginRepeatableSubField` types to
`ampless`, enabling plugins to declare list-of-objects settings (e.g.
cookie-consent categories). Each item is a flat object validated against
declared sub-fields (scalar types only: text / textarea / boolean /
number / select / url).

`validatePluginSettingValue` gains a third parameter
`mode: 'strict' | 'lenient'` (default `'lenient'`, so all existing
call sites are unaffected). Admin saves now pass `'strict'`: any
invalid item rejects the whole field. The runtime resolver continues
in `'lenient'` mode, silently dropping invalid items instead.

Optional sub-field handling: absent-with-default → adopt default;
absent-without-default → omit key entirely; invalid-optional → drop
key only (item remains valid). Required sub-field missing or invalid →
item invalid (strict: field reject, lenient: item drop).
