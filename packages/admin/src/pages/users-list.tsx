import { redirect } from 'next/navigation'
import type { Admin } from '../index.js'
import { UsersListView } from '../components/users-list-view.js'

/**
 * Admin-only user management page. Second-layer authz gate (the
 * layout factory already shuts out non-editor sessions, but `editor`
 * has no business here — Cognito group changes belong to admin).
 */
export function createUsersListPage(admin: Admin) {
  async function UsersPage() {
    const session = await admin.getServerSession()
    if (!admin.isAdmin(session)) {
      redirect('/admin')
    }
    return <UsersListView currentUserId={session!.userId} />
  }
  return UsersPage
}
