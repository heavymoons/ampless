---
"@ampless/plugin-youtube": patch
---

Initial release: first-party YouTube embed plugin for ampless (Phase 7 `contentFields` capability). Expands `https://youtu.be/<id>` and `https://www.youtube.com/watch?v=<id>` URLs into iframes pointing at `youtube-nocookie.com`. Server entry contributes the runtime `contentFields` renderers; `./editor` subpath contributes the tiptap `amplessYoutube` Node + paste rule for the admin editor.
