import type { SQSHandler } from 'aws-lambda'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'
import {
  formatPublicAssetUrl,
  isValidPluginKey,
  validatePublicAssetKey,
  type AmplessEvent,
  type AmplessPlugin,
  type Config,
  type TrustedPluginRuntimeContext,
  type Post,
  type PostIndexEventPayload,
} from 'ampless'
import { computePostTagDiff } from './posttag-sync.js'

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
 * `public/plugins/{instanceId ?? name}/{key}`).
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
  // Trusted plugins live behind a bucket-wide IAM grant on
  // `public/plugins/*`, so the per-plugin namespace is the only thing
  // separating one plugin's output from another's. Reject anything that
  // can't safely round-trip through an S3 key + URL — namespaces with
  // path separators or `..` would let a plugin escape its own prefix and
  // clobber a sibling. The pattern matches the same `PLUGIN_KEY_PATTERN`
  // (`/^[a-zA-Z0-9_-]+$/`) the docs and `ctx.setting` keys already use.
  const trustedPlugins: AmplessPlugin[] = (opts.plugins ?? [])
    .filter(
      (p): p is AmplessPlugin => typeof p === 'object' && p.trust_level === 'trusted'
    )
    .filter((p) => {
      const ns = p.instanceId ?? p.name
      if (!isValidPluginKey(ns)) {
        console.warn(
          `[trusted-processor] plugin "${p.name}" (instanceId="${p.instanceId ?? '(none)'}") has invalid namespace "${ns}". Must match /^[a-zA-Z0-9_-]+$/. Plugin skipped — no hooks will run for it.`
        )
        return false
      }
      return true
    })
  const seenNamespaces = new Set<string>()
  for (const plugin of trustedPlugins) {
    const ns = plugin.instanceId ?? plugin.name
    if (seenNamespaces.has(ns)) {
      console.warn(
        `[trusted-processor] duplicate plugin namespace "${ns}" detected in trusted plugins. Set distinct \`instanceId\` on each instance to disambiguate writePublicAsset output.`
      )
    }
    seenNamespaces.add(ns)
  }
  const warnedWritePublicAssetCapability = new Set<string>()

  const s3 = new S3Client({})
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

  const BUCKET = requireEnv('AMPLESS_BUCKET_NAME')
  const POST_TABLE = requireEnv('AMPLESS_POST_TABLE')
  const KV_TABLE = requireEnv('AMPLESS_KV_TABLE')
  const POSTTAG_TABLE = requireEnv('AMPLESS_POSTTAG_TABLE')
  const PLUGIN_SECRET_TABLE = requireEnv('AMPLESS_PLUGIN_SECRET_TABLE')
  // AWS_REGION is always set by the Lambda runtime; require it so a
  // misconfigured deploy fails at cold start instead of producing wrong
  // regional URLs at runtime.
  const REGION = requireEnv('AWS_REGION')

  // Raw DynamoDB client for PluginSecret GetItem. We use the raw client
  // (not DocumentClient) to stay explicit about the marshall/unmarshall
  // boundary — secret reads are sensitive operations and we want the
  // code path to be as clear as possible.
  const rawDdb = new DynamoDBClient({})

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

  function makeContext(plugin: AmplessPlugin): TrustedPluginRuntimeContext {
    const namespace = plugin.instanceId ?? plugin.name
    const label = plugin.instanceId ? `${plugin.name}#${plugin.instanceId}` : plugin.name

    // Per-invocation cache for secret reads. Key is
    // `${instanceId ?? name}:${fieldKey}` — must be compound to prevent
    // cross-plugin collisions when two plugin instances declare the same
    // field key (e.g. both have 'signingSecret').
    // Lifetime: this Map is created fresh per makeContext() call (once per
    // plugin per SQS batch), so it's scoped to one plugin's hook execution
    // within the batch. Two different plugins never share a cache.
    const secretCache = new Map<string, unknown>()

    return {
      site: opts.site,
      listPublishedPosts: () => listPublished(),
      async writePublicAsset(key, body, contentType) {
        const keyError = validatePublicAssetKey(key)
        if (keyError) {
          throw new Error(`[${plugin.name}] writePublicAsset: ${keyError}`)
        }

        if (
          plugin.capabilities &&
          !plugin.capabilities.includes('writePublicAsset') &&
          !warnedWritePublicAssetCapability.has(label)
        ) {
          console.warn(
            `[trusted-processor] ${label}: called ctx.writePublicAsset() but "writePublicAsset" is not in declared capabilities. Add it so admin UI / capability gates see the surface.`
          )
          warnedWritePublicAssetCapability.add(label)
        }

        const objectKey = `public/plugins/${namespace}/${key}`
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

      async secret<T = string>(key: string): Promise<T | undefined> {
        // Cache key is compound: plugin namespace + field key. This
        // prevents cross-plugin collisions when two plugin instances
        // both declare a field named e.g. 'signingSecret'.
        const cacheKey = `${namespace}:${key}`
        if (secretCache.has(cacheKey)) {
          return secretCache.get(cacheKey) as T | undefined
        }

        // DDB sort key convention: `plugins.<instanceId ?? name>.<fieldKey>`
        const sk = `plugins.${namespace}.${key}`
        try {
          const result = await rawDdb.send(
            new GetItemCommand({
              TableName: PLUGIN_SECRET_TABLE,
              Key: marshall({ siteId: 'default', sk }),
            })
          )
          const value = result.Item ? (unmarshall(result.Item).value as string) : undefined
          secretCache.set(cacheKey, value)
          return value as T | undefined
        } catch (err) {
          console.error(
            `[trusted-processor] ${label}: ctx.secret("${key}") DDB read failed`,
            err
          )
          // Do not cache errors — allow retry on next call in case of
          // transient DDB error.
          return undefined
        }
      },
    }
  }

  // --- Built-in: PostTag denormalized index ---
  //
  // For each Post mutation the dispatcher emits a `post.index.refresh`
  // event carrying both the previous and next projection. This handler
  // delegates the diff math to `computePostTagDiff` (pure, unit-tested
  // in `posttag-sync.test.ts`) and applies the result via direct
  // DynamoDB — faster than going through AppSync and a narrower IAM
  // grant than full GraphQL mutate access on the PostTag model.
  //
  // Centralising the logic here means write paths (admin, MCP tools,
  // future REST clients) don't need to call a sync helper — any Post
  // write that hits DynamoDB is automatically followed by a PostTag
  // rebuild via the Stream pipeline.
  async function rebuildPostTagsForPost(payload: PostIndexEventPayload): Promise<void> {
    const { deletes, puts } = computePostTagDiff(payload)
    await Promise.all([
      ...deletes.map((key) =>
        ddb.send(
          new DeleteCommand({
            TableName: POSTTAG_TABLE,
            Key: key,
          })
        )
      ),
      ...puts.map((item) =>
        ddb.send(
          new PutCommand({
            TableName: POSTTAG_TABLE,
            Item: item,
          })
        )
      ),
    ])
    const postId = payload.next?.postId ?? payload.previous?.postId ?? '(unknown)'
    console.log(
      `[posttag-sync] postId=${postId} ` +
        `removed=${deletes.length} upserted=${puts.length}`
    )
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

      // Built-in: refresh the PostTag denormalized index. Runs before
      // user plugins so theme code that reads tag pages sees the
      // up-to-date index when reacting to content.* events.
      if (parsed.type === 'post.index.refresh') {
        try {
          await rebuildPostTagsForPost(parsed.payload as unknown as PostIndexEventPayload)
        } catch (err) {
          console.error('[trusted-processor] posttag-sync failed', err)
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
