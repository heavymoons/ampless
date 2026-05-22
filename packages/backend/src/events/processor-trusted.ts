import type { SQSHandler } from 'aws-lambda'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import {
  formatPublicAssetUrl,
  type AmplessEvent,
  type AmplessPlugin,
  type Config,
  type PluginRuntimeContext,
  type Post,
} from 'ampless'

export interface CreateProcessorTrustedHandlerOpts {
  /**
   * The full `cms.config.plugins` array. The handler filters down to
   * trusted plugins itself so callers don't need to remember the
   * filter, and so adding `privileged` later only touches the handler
   * code in this package.
   *
   * Accepts the raw `Config['plugins']` shape (which permits string
   * entries for future dynamic loading) — the runtime filter discards
   * anything that isn't a plugin object.
   */
  plugins?: Config['plugins']
  /**
   * The `cms.config.site` block, surfaced to plugin hooks via
   * `ctx.site`. Pass through from the thin shell — handlers must
   * not import `cms.config` directly because the package can't know
   * the user's project layout.
   */
  site: Config['site']
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`processor-trusted: missing required env var ${name}`)
  return v
}

const POST_BY_STATUS_INDEX = 'byStatus'

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch (err) {
    console.warn('[trusted-processor] post.body is not valid JSON; passing through as string', err)
    return s
  }
}

/**
 * SQS-driven trusted plugin executor. Trusted plugins get a runtime
 * context with `listPublishedPosts` (one Query against the byStatus
 * GSI) and `writePublicAsset` (S3 PutObject under
 * `public/plugins/{name}/{key}`).
 *
 * Built-in: rebuilds the site-settings JSON cache at
 * `public/site-settings.json` whenever a `site.settings.updated`
 * event arrives.
 *
 * Re-exported by the template's thin shell
 * `amplify/events/processor-trusted/handler.ts` which supplies the
 * site-wide plugin list and site config from `cms.config`.
 */
export function createProcessorTrustedHandler(
  opts: CreateProcessorTrustedHandlerOpts
): SQSHandler {
  const trustedPlugins: AmplessPlugin[] = (opts.plugins ?? []).filter(
    (p): p is AmplessPlugin => typeof p === 'object' && p.trust_level === 'trusted'
  )

  const s3 = new S3Client({})
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

  const BUCKET = requireEnv('AMPLESS_BUCKET_NAME')
  const POST_TABLE = requireEnv('AMPLESS_POST_TABLE')
  const KV_TABLE = requireEnv('AMPLESS_KV_TABLE')
  // AWS_REGION is always set by the Lambda runtime; require it so a
  // misconfigured deploy fails at cold start instead of producing wrong
  // regional URLs at runtime.
  const REGION = requireEnv('AWS_REGION')

  // One Query against the `byStatus` GSI: PK = 'published', SK
  // (publishedAt) gives newest-first ordering with `ScanIndexForward:
  // false`. No filter needed — drafts live in a different partition.
  async function listPublished(): Promise<Post[]> {
    const items: Post[] = []
    let exclusiveStartKey: Record<string, unknown> | undefined
    do {
      const res = await ddb.send(
        new QueryCommand({
          TableName: POST_TABLE,
          IndexName: POST_BY_STATUS_INDEX,
          KeyConditionExpression: '#status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': 'published' },
          ScanIndexForward: false,
          ExclusiveStartKey: exclusiveStartKey as never,
        })
      )
      for (const row of res.Items ?? []) {
        items.push({
          postId: row.postId,
          slug: row.slug,
          title: row.title,
          excerpt: row.excerpt ?? undefined,
          format: row.format ?? 'markdown',
          body: typeof row.body === 'string' ? safeParse(row.body) : row.body,
          status: row.status ?? 'published',
          publishedAt: row.publishedAt ?? undefined,
          tags: Array.isArray(row.tags) ? row.tags : [],
        })
      }
      exclusiveStartKey = res.LastEvaluatedKey
    } while (exclusiveStartKey)
    return items
  }

  function makeContext(plugin: AmplessPlugin): PluginRuntimeContext {
    return {
      site: opts.site,
      listPublishedPosts: () => listPublished(),
      async writePublicAsset(key, body, contentType) {
        const objectKey = `public/plugins/${plugin.name}/${key}`
        await s3.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: objectKey,
            Body: body as never,
            ContentType: contentType,
            CacheControl: 'public, max-age=300',
          })
        )
        return formatPublicAssetUrl(BUCKET, REGION, objectKey)
      },
    }
  }

  // --- Built-in: site settings cache ---
  //
  // Whenever any `siteconfig` row in KvStore changes, the dispatcher
  // emits a `site.settings.updated` event. This handler reads every
  // setting under that PK and writes a single JSON object to S3 at
  // `public/site-settings.json`. The Next.js public site fetches that
  // file on render — the database is never reached on the public path.
  //
  // Built into the trusted processor (not a user plugin) because the
  // public site cannot function without site settings being cached out
  // to S3.
  async function rebuildSiteSettingsCache(): Promise<void> {
    const settings: Record<string, unknown> = {}
    let exclusiveStartKey: Record<string, unknown> | undefined
    do {
      const res = await ddb.send(
        new QueryCommand({
          TableName: KV_TABLE,
          KeyConditionExpression: '#pk = :pk',
          ExpressionAttributeNames: { '#pk': 'pk' },
          ExpressionAttributeValues: { ':pk': 'siteconfig' },
          ExclusiveStartKey: exclusiveStartKey as never,
        })
      )
      for (const row of res.Items ?? []) {
        const sk = row.sk as string | undefined
        if (!sk) continue
        // `value` is stored as AWSJSON (a string holding serialized JSON);
        // decode for consumers, fall back to the raw value for resilience.
        const raw = row.value
        settings[sk] = typeof raw === 'string' ? safeParse(raw) : raw
      }
      exclusiveStartKey = res.LastEvaluatedKey
    } while (exclusiveStartKey)

    const objectKey = 'public/site-settings.json'
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
        Body: JSON.stringify(settings),
        ContentType: 'application/json; charset=utf-8',
        // Public site fetches with Next.js fetch cache (60s) — keep this
        // short so admin edits propagate quickly without thrashing.
        CacheControl: 'public, max-age=60',
      })
    )
    console.log(
      `[site-settings-cache] wrote ${objectKey} (${Object.keys(settings).length} keys)`
    )
  }

  return async (event) => {
    for (const record of event.Records) {
      let parsed: AmplessEvent
      try {
        parsed = JSON.parse(record.body) as AmplessEvent
      } catch (err) {
        console.error('[trusted-processor] bad message', record.body, err)
        continue
      }

      // Built-in: rebuild the site settings JSON cache. Runs before user
      // plugins so they observe a consistent S3 state if they read it.
      if (parsed.type === 'site.settings.updated') {
        try {
          await rebuildSiteSettingsCache()
        } catch (err) {
          console.error('[trusted-processor] site-settings-cache rebuild failed', err)
          throw err
        }
      }

      for (const plugin of trustedPlugins) {
        const hook = plugin.hooks?.[parsed.type]
        if (!hook) continue
        try {
          await hook(parsed as never, makeContext(plugin))
        } catch (err) {
          // Re-throw so SQS retries. After maxReceiveCount the message lands in DLQ.
          console.error(`[trusted-processor] ${plugin.name}.${parsed.type} failed`, err)
          throw err
        }
      }
    }
  }
}
