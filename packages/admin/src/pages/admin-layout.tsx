import { redirect } from 'next/navigation'
import type { Config } from 'ampless'
import type { Admin } from '../index.js'
import { I18nProvider } from '../components/i18n-provider.js'
import { Sidebar } from '../components/sidebar.js'
import { AdminProviders } from '../components/admin-providers.js'

/**
 * Strip plugin function fields (hooks, metadata, etc.) before sending
 * cmsConfig across the server→client boundary. Plugin instances carry
 * Lambda-side event handlers that React's RSC serializer rejects:
 *
 *   Functions cannot be passed directly to Client Components unless
 *   you explicitly expose it by marking it with "use server".
 *
 * Client state modules only read `cmsConfig.site` / `media` — never
 * `plugins[].hooks` — so reducing each plugin instance to its
 * metadata (name / apiVersion / trust_level) is safe.
 */
function sanitizeCmsConfigForClient(config: Config): Config {
  return {
    ...config,
    plugins: (config.plugins ?? []).map((p) =>
      typeof p === 'string'
        ? p
        : { name: p.name, apiVersion: p.apiVersion, trust_level: p.trust_level }
    ) as Config['plugins'],
  }
}

/**
 * Options for `createAdminLayout`.
 */
export interface CreateAdminLayoutOptions {
  /**
   * Phase 7 slot for first-party embed plugins. Templates pass a
   * client-component wrapper that calls
   * `installAdminEditorExtensions([...])` at the top of its render and
   * returns `<>{children}</>`. The layout wraps every admin route
   * inside it so the registration runs once before <TiptapEditor>
   * mounts. When omitted, children render directly (built-in editor
   * extensions only).
   */
  editorBootstrap?: React.ComponentType<{ children: React.ReactNode }>
}

/**
 * Build the admin layout component. Wraps every admin route with:
 *
 * - An auth gate (`redirect('/login')` if the visitor isn't in the
 *   `ampless-admin` or `ampless-editor` Cognito group).
 * - The admin sidebar.
 * - An i18n provider hydrated from the resolved locale dict.
 * - A client-side `AdminProviders` shell that configures the Amplify
 *   SDK and installs the admin's posts / kv providers once on mount.
 * - An optional `editorBootstrap` slot (Phase 7) so templates can wire
 *   first-party embed plugins' tiptap extensions into <TiptapEditor>.
 */
export function createAdminLayout(
  admin: Admin,
  opts: CreateAdminLayoutOptions = {},
) {
  const EditorBootstrap = opts.editorBootstrap
  async function AdminLayout({ children }: { children: React.ReactNode }) {
    const session = await admin.getServerSession()
    if (!admin.isEditor(session)) {
      redirect('/login')
    }

    const inner = (
      <I18nProvider locale={admin.locale} dict={admin.dict}>
        <div className="flex min-h-screen flex-col md:flex-row">
          <Sidebar
            email={session!.email}
            isAdmin={admin.isAdmin(session)}
          />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </I18nProvider>
    )

    return (
      <AdminProviders outputs={admin.outputs} cmsConfig={sanitizeCmsConfigForClient(admin.cmsConfig)}>
        {EditorBootstrap ? <EditorBootstrap>{inner}</EditorBootstrap> : inner}
      </AdminProviders>
    )
  }
  return AdminLayout
}
