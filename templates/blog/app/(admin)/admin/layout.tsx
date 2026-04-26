import { redirect } from 'next/navigation'
import { getServerSession, isEditor } from '@/lib/auth-server'
import { Sidebar } from '@/components/admin/sidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession()
  if (!isEditor(session)) {
    redirect('/login')
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar email={session!.email} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
