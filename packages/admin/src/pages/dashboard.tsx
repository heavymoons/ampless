import { AdminDashboard } from '../components/admin-dashboard.js'

/**
 * Admin home / dashboard. Lists post counts. The view is a client
 * component (`AdminDashboard`) — this factory module stays server-side
 * so `@ampless/admin/pages` can be imported from Server Components, and
 * the `'use client'` boundary is preserved at the cross-file reference.
 */
export function createAdminDashboardPage(_admin: unknown) {
  return AdminDashboard
}
