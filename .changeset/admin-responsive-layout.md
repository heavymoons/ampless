---
"@ampless/admin": patch
---

Responsive admin layout: the sidebar collapses into a slide-in drawer below `md` (768px) with a sticky top bar and hamburger toggle, and turns back into a persistent 240px rail on tablets/desktops. The drawer auto-closes on route change and locks page scroll while open.

Page bodies now use `mx-auto max-w-7xl p-4 md:p-8` so admin content centers on wide screens. Page titles shrink to `text-2xl` below `md` to leave room for the action button next to them, and table containers gain `overflow-x-auto` so the posts / sites tables don't push out the viewport on narrow screens.
