import Link from 'next/link'
import { DEFAULT_SITE_ID, isMultiSite, siteFor } from 'ampless'
import cmsConfig from '@/cms.config'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { t } from '@/lib/i18n'

export const dynamic = 'force-dynamic'

// Sites overview. In single-site mode there's exactly one row
// (`default`); in multi-site mode each declared site shows up. Adding
// / removing sites is still done in cms.config.ts (the domains[] field
// is wired to DNS / SSL outside ampless's reach).
export default async function SitesPage() {
  const multi = isMultiSite(cmsConfig)
  const ids = multi ? Object.keys(cmsConfig.sites ?? {}) : [DEFAULT_SITE_ID]

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('sites.list.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('sites.list.description')}</p>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('sites.list.columnSiteId')}</TableHead>
              <TableHead>{t('sites.list.columnName')}</TableHead>
              <TableHead>{t('sites.list.columnUrl')}</TableHead>
              <TableHead>{t('sites.list.columnDomains')}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ids.map((id) => {
              const site = siteFor(id, cmsConfig)
              const domains = cmsConfig.sites?.[id]?.domains ?? []
              return (
                <TableRow key={id}>
                  <TableCell className="font-mono text-xs">{id}</TableCell>
                  <TableCell className="font-medium">{site.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{site.url}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {domains.length > 0 ? domains.join(', ') : '—'}
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/sites/${id}`}>{t('sites.list.edit')}</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
