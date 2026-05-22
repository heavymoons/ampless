import type { PostStatus } from './types.js'

/**
 * Site identifier. ampless runs one site per Amplify deployment, so
 * this is a constant `'default'` everywhere a `siteId` column / GSI
 * key needs to be populated.
 *
 * The schema retains the `siteId` column on Post / Media / etc. as a
 * forward-compat hook in case multi-site is ever re-introduced. New
 * writes always set it to this constant; existing data already uses
 * `'default'`, so no migration is needed.
 */
export const DEFAULT_SITE_ID = 'default'

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
