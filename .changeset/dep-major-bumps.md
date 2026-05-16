---
"ampless": patch
"create-ampless": patch
"@ampless/runtime": patch
"@ampless/admin": patch
"@ampless/backend": patch
"@ampless/mcp-server": patch
"@ampless/plugin-seo": patch
"@ampless/plugin-rss": patch
"@ampless/plugin-webhook": patch
"@ampless/plugin-og-image": patch
---

Bump all direct dependencies to latest majors so the alpha track isn't carrying a major version behind. Notable bumps:

- `typescript` 5.9 → 6.0
- `next` 15 → 16 (Amplify adapter-nextjs peer allows up to <17)
- `@tiptap/*` 2.27 → 3.23 — editor API migration (BubbleMenu moved to `@tiptap/react/menus`, `tippyOptions` → `options` for Floating-UI)
- `vitest` 2 → 4
- `eslint` 9 → 10
- `lucide-react` 0.469 → 1.16
- `tailwind-merge` 2 → 3
- `@jsquash/avif` 1 → 2
- `@clack/prompts` 0.9 → 1.4
- plus all minor / patch refreshes (turbo, @aws-sdk, changesets, @types/node, typescript-eslint, vite)

Behavioural code changes:
- `theme-actions.ts`: `revalidateTag` → `updateTag` (Next 16's read-your-own-writes variant for Server Actions)
- `image-bubble-menu.tsx`: tiptap 3 import path + Floating-UI option shape
- TS 6 strict-mode fixes (catch params, side-effect css import declaration)
