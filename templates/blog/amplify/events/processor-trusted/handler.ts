import type { SQSHandler } from 'aws-lambda'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import {
  formatPublicAssetUrl,
  type AmplessEvent,
  type AmplessPlugin,
  type PluginRuntimeContext,
  type Post,
} from 'ampless'
import config from '../../../cms.config'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`processor-trusted: missing required env var ${name}`)
  return v
}

const s3 = new S3Client({})
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const BUCKET = requireEnv('AMPLESS_BUCKET_NAME')
const POST_TABLE = requireEnv('AMPLESS_POST_TABLE')
// AWS_REGION is always set by the Lambda runtime; require it so a
// misconfigured deploy fails at cold start instead of producing wrong
// regional URLs at runtime.
const REGION = requireEnv('AWS_REGION')
const POST_BY_STATUS_INDEX = 'byStatus'

const trustedPlugins: AmplessPlugin[] = (config.plugins ?? []).filter(
  (p): p is AmplessPlugin => typeof p === 'object' && p.trust_level === 'trusted'
)

// v0.1 single-site assumption: byStatus GSI is keyed only on `status`, so
// we scan all published posts and filter by siteId post-query. v0.2
// multi-site work plans to recompose this GSI as `siteId+status` so the
// filter becomes a key condition (see ARCHITECTURE.md §3 / roadmap).
async function listPublished(siteId: string): Promise<Post[]> {
  const items: Post[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: POST_TABLE,
        IndexName: POST_BY_STATUS_INDEX,
        KeyConditionExpression: '#status = :status',
        FilterExpression: '#siteId = :siteId',
        ExpressionAttributeNames: { '#status': 'status', '#siteId': 'siteId' },
        ExpressionAttributeValues: { ':status': 'published', ':siteId': siteId },
        ExclusiveStartKey: exclusiveStartKey as never,
      })
    )
    for (const row of res.Items ?? []) {
      items.push({
        postId: row.postId,
        siteId: row.siteId,
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
  // Newest first.
  items.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
  return items
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch (err) {
    console.warn('[trusted-processor] post.body is not valid JSON; passing through as string', err)
    return s
  }
}

function makeContext(plugin: AmplessPlugin, siteId: string): PluginRuntimeContext {
  return {
    siteId,
    site: config.site,
    listPublishedPosts: () => listPublished(siteId),
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

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    let parsed: AmplessEvent
    try {
      parsed = JSON.parse(record.body) as AmplessEvent
    } catch (err) {
      console.error('[trusted-processor] bad message', record.body, err)
      continue
    }
    const siteId = (parsed.payload as { siteId?: string }).siteId ?? 'default'
    for (const plugin of trustedPlugins) {
      const hook = plugin.hooks?.[parsed.type]
      if (!hook) continue
      try {
        await hook(parsed as never, makeContext(plugin, siteId))
      } catch (err) {
        // Re-throw so SQS retries. After maxReceiveCount the message lands in DLQ.
        console.error(`[trusted-processor] ${plugin.name}.${parsed.type} failed`, err)
        throw err
      }
    }
  }
}
