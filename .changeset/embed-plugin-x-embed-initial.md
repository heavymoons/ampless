---
"@ampless/plugin-x-embed": patch
---

Initial release: first-party x.com (Twitter) embed plugin for ampless (Phase 7 `contentFields` + `publicPostScript` capabilities). Expands `https://x.com/<handle>/status/<id>` and `https://twitter.com/<handle>/status/<id>` URLs into `<blockquote class="twitter-tweet">` cards. Emits the `publicPostScript` descriptor that injects `platform.twitter.com/widgets.js` once per page that actually has a tweet embed. `./editor` subpath contributes the tiptap `amplessTweet` Node + paste rule for the admin editor.
