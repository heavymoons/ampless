---
"@ampless/plugin-youtube": patch
"@ampless/plugin-x-embed": patch
---

Fix paste rule completely broken on both embed plugins. The
`addPasteRules` regex (`YOUTUBE_URL` / `TWEET_URL`) was passed straight
through from the shared module, where it's defined with `^...$` anchors
but without the `g` flag. tiptap's paste-rule pipeline calls
`String.prototype.matchAll(rule.find)` internally — `matchAll`
**requires** a global regex and throws
`TypeError: String.prototype.matchAll called with a non-global RegExp argument`
otherwise. Result: every URL paste in the admin editor silently fell
back to plain autolink text instead of being converted into an
`amplessYoutube` / `amplessTweet` node, so the public renderer had
nothing to intercept.

Fix is a 1-line change in each plugin's `editor.tsx`: wrap the regex in
`new RegExp(YOUTUBE_URL.source, 'g')` before handing it to tiptap. The
shared `YOUTUBE_URL` / `TWEET_URL` regexes stay anchored for the
renderer / `extractSingleUrl` callers, which is correct.

Affects alpha.1 through alpha.4 of both plugins; alpha.5 (this fix) is
the first working release. Sites that have alpha.4 installed only need
`npm i @ampless/plugin-youtube@alpha @ampless/plugin-x-embed@alpha`
once alpha.5 ships.
