---
'@ampless/admin': patch
---

Show published posts whose `publishedAt` is still in the future as
"Scheduled" (ja: 公開予約) in the admin posts list, dashboard, and post
form, instead of "Published". The posts list gains a "Scheduled" status
filter (the "Published" filter now excludes scheduled posts), and the
dashboard gets a Scheduled count. Labels flip to "Published" when the
scheduled time arrives while the page is open. Display-only — stored
data, save logic, and public visibility are unchanged.
