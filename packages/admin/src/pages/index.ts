// `@ampless/admin/pages` — Next.js page component factories.
//
// Each factory takes the `Admin` instance and returns a React
// component suitable for `export default`-ing from a Next.js app
// router page file. Templates expose each admin route as a thin shell:
//
//     // app/(admin)/admin/posts/page.tsx
//     import { admin } from '@/lib/admin'
//     import { createPostsListPage } from '@ampless/admin/pages'
//     export default createPostsListPage(admin)
//
// The factories are split per-page rather than one giant export so
// templates only client-bundle the components they actually render.
// Pages that need cmsConfig / settings / theme list at request time
// (sites list, site edit, theme edit) are server components; the
// rest are 'use client' and stream their data in via AppSync at mount.

export { createAdminLayout } from './admin-layout.js'
export { createAdminDashboardPage } from './dashboard.js'
export { createPostsListPage } from './posts-list.js'
export { createNewPostPage } from './post-new.js'
export { createEditPostPage } from './post-edit.js'
export { createMediaPage } from './media.js'
export { createSiteEditPage } from './site-edit.js'
export { createSiteThemePage } from './site-theme.js'
export { createUsersListPage } from './users-list.js'
export { createMcpTokensPage } from './mcp-tokens.js'
export { createPluginsPage } from './plugins.js'
export { createLoginPage } from './login.js'
