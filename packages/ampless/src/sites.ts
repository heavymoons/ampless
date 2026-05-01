import type { Config, PostStatus } from './types.js'

/**
 * Single-site fallback identifier. Used when `cms.config.sites` is unset
 * or empty — keeps existing single-site code paths working without
 * special-casing.
 */
export const DEFAULT_SITE_ID = 'default'

/**
 * Resolve a hostname to a configured siteId.
 *
 * - Single-site mode (no `sites` defined or empty): always returns
 *   `DEFAULT_SITE_ID` regardless of host. The single site catches
 *   every request.
 * - Multi-site mode: looks up the host in each site's `domains` list.
 *   Returns `null` if the host is not registered (caller should 404).
 *
 * The host comparison is case-insensitive; ports are not stripped here
 * — pass the bare hostname (e.g. `'site-a.example.com'`).
 */
export function resolveSiteId(host: string, config: Config): string | null {
  const sites = config.sites
  if (!sites || Object.keys(sites).length === 0) {
    return DEFAULT_SITE_ID
  }
  const lower = host.toLowerCase()
  for (const [id, site] of Object.entries(sites)) {
    if (site.domains.some((d) => d.toLowerCase() === lower)) return id
  }
  return null
}

/**
 * Multi-site mode iff two or more sites are declared. A single declared
 * site is treated as single-site mode (the explicit declaration just lets
 * the operator name the site, but no host disambiguation is needed).
 */
export function isMultiSite(config: Config): boolean {
  return !!config.sites && Object.keys(config.sites).length >= 2
}

/**
 * Site-effective name / url / description for a given siteId. Per-site
 * `sites.{id}.{name|url|description}` overrides the top-level `site.*`
 * defaults; otherwise falls through.
 */
export function siteFor(
  siteId: string,
  config: Config
): { name: string; url: string; description?: string } {
  const override = config.sites?.[siteId]
  return {
    name: override?.name ?? config.site.name,
    url: override?.url ?? config.site.url,
    description: override?.description ?? config.site.description,
  }
}

/**
 * Build the denormalized GSI key for `bySiteIdStatus`. All Post writes
 * (admin client, MCP tools) must set this so the public-read resolvers
 * can do a single Query without table-level filtering.
 */
export function composeSiteIdStatus(siteId: string, status: PostStatus): string {
  return `${siteId}#${status}`
}

/**
 * Build the denormalized GSI key for `bySiteIdSlug`. The public
 * `getPublishedPost(slug)` resolver does an O(1) PK lookup against
 * this index, so every Post write must set it alongside the slug.
 */
export function composeSiteIdSlug(siteId: string, slug: string): string {
  return `${siteId}#${slug}`
}
