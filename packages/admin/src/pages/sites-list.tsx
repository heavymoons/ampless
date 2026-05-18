import Link from 'next/link'
import { DEFAULT_SITE_ID, isMultiSite, siteFor } from 'ampless'
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ampless/runtime/ui'
import type { Admin } from '../index.js'

/**
 * Sites overview. In single-site mode there's exactly one row
 * (`default`); in multi-site mode each declared site shows up. Adding
 * / removing sites is still done in cms.config.ts (the domains[] field
 * is wired to DNS / SSL outside ampless's reach).
 */
export function createSitesListPage(admin: Admin) {
  const { cmsConfig, t } = admin

  async function SitesPage() {
    const multi = isMultiSite(cmsConfig)
    const ids = multi ? Object.keys(cmsConfig.sites ?? {}) : [DEFAULT_SITE_ID]

    return (
      <div className="mx-auto max-w-7xl p-4 md:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 md:mb-8">
          <div>
            <h1 className="text-2xl font-bold md:text-3xl">{t('sites.list.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('sites.list.description')}</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
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

  return SitesPage
}
