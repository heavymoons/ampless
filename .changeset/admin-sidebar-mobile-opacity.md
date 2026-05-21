---
"@ampless/admin": patch
---

Fix the admin sidebar mobile drawer letting page content bleed through. The drawer shared `bg-muted/30` with the desktop persistent rail, but on mobile the drawer overlays the content area — at 30% opacity the post list / editor showed through and made nav items hard to read.

Use `bg-background` (opaque) on small screens; keep `md:bg-muted/30` so the desktop rail retains its subtle tint where there's no content behind it.
