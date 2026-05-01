'use client'

import { useRouter } from 'next/navigation'
import { ADMIN_SITE_COOKIE } from '@/lib/admin-site-client'
import { useT } from '@/components/i18n-provider'

interface SiteOption {
  id: string
  name: string
}

interface Props {
  current: string
  sites: SiteOption[]
}

// Multi-site selector for the admin sidebar. Stores the choice in a
// year-long cookie so it survives navigation, and refreshes the
// current page so server components re-read the new siteId.
export function SiteSelector({ current, sites }: Props) {
  const router = useRouter()
  const t = useT()

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    document.cookie = `${ADMIN_SITE_COOKIE}=${encodeURIComponent(next)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`
    router.refresh()
  }

  return (
    <div className="px-3 py-2">
      <label className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">
        {t('sites.selector.label')}
      </label>
      <select
        value={current}
        onChange={onChange}
        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      >
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  )
}
