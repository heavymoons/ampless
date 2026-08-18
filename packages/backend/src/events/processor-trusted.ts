import { createDecipheriv } from 'node:crypto'
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

// ---------------------------------------------------------------------------
// AES-256-GCM decryption (node:crypto)
// ---------------------------------------------------------------------------
//
// Ciphertext format on disk (base64-encoded):
//   IV[12] || ciphertext || authTag[16]
//
// The plugin-secret-handler Lambda (Node.js) encrypts using
// `createCipheriv('aes-256-gcm')` and stores the result in the same
// layout. Node.js `createDecipheriv` requires ciphertext and authTag
// separately, so we slice them back out after base64-decoding.

/**
 * Decrypt one AES-256-GCM ciphertext blob.
 * @param rawKey   32-byte Buffer
 * @param b64      base64( IV[12] || ciphertext || authTag[16] )
 */
export function decryptSecret(rawKey: Buffer, b64: string): string {
  const combined = Buffer.from(b64, 'base64')
  if (combined.byteLength < 12 + 16) {
    throw new Error(
      `[trusted-processor] decryptSecret: ciphertext blob too short (${combined.byteLength} bytes)`
    )
  }
  const iv = combined.subarray(0, 12)
  const authTag = combined.subarray(combined.byteLength - 16)
  const ciphertext = combined.subarray(12, combined.byteLength - 16)

  const decipher = createDecipheriv('aes-256-gcm', rawKey, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
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
  const privilegedHookedPlugins: AmplessPlugin[] = (opts.plugins ?? []).filter(
    (p): p is AmplessPlugin =>
      typeof p === 'object' &&
      p.trust_level === 'privileged' &&
      !!p.hooks &&
      Object.keys(p.hooks).length > 0
  )
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

  // ---------------------------------------------------------------------------
  // Encryption key — read from process.env at module-load time (v2.2).
  //
  // Source: PLUGIN_SECRET_ENCRYPTION_KEY env var (base64, 32 bytes).
  // Set by defineAmplessBackend() via CDK addEnvironment() from the value
  // passed as opts.pluginSecretEncryptionKey (origin: amplify/secrets/
  // encryption-key.ts, generated by `npx create-ampless@beta setup-encryption-key`).
  //
  // If the env var is absent (key not yet provisioned), we fall back to
  // null so ctx.secret() returns undefined with a warning rather than crashing.
  // ---------------------------------------------------------------------------
  const _encKeyB64 = process.env.PLUGIN_SECRET_ENCRYPTION_KEY
  const ENCRYPTION_KEY: Buffer | null = (() => {
    if (!_encKeyB64) return null
    const buf = Buffer.from(_encKeyB64, 'base64')
    if (buf.byteLength !== 32) {
      console.error(
        `[trusted-processor] PLUGIN_SECRET_ENCRYPTION_KEY must encode 32 bytes ` +
          `(got ${buf.byteLength}); secrets will not be decryptable.`
      )
      return null
    }
    return buf
  })()

  function getEncryptionKey(): Buffer | null {
    return ENCRYPTION_KEY
  }

  // One Query (with auto-pagination) against the `byStatus` GSI:
  // PK = 'published', SK (publishedAt) gives newest-first ordering with
  // `ScanIndexForward: false`. Scheduled-publish: the SK upper bound is
  // clamped to `now` so future-dated published posts (scheduled but not
  // yet live) are excluded from plugin-generated feeds and sitemaps.
  async function listPublished(): Promise<Post[]> {
    const items: Post[] = []
    let exclusiveStartKey: Record<string, unknown> | undefined
    do {
      const res = await ddb.send(
        new QueryCommand({
          TableName: POST_TABLE,
          IndexName: POST_BY_STATUS_INDEX,
          KeyConditionExpression: '#status = :status AND #publishedAt <= :now',
          ExpressionAttributeNames: { '#status': 'status', '#publishedAt': 'publishedAt' },
          ExpressionAttributeValues: { ':status': 'published', ':now': new Date().toISOString() },
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
          // DynamoDBDocumentClient unmarshals AWSJSON-backed attributes
          // into native JS types (S→string, N→number, BOOL→boolean,
          // M→object), so `row.body` is already correctly typed here and
          // must NOT be re-parsed. Re-running JSON.parse on a pure-numeric
          // or JSON-looking string body (e.g. a markdown/html body of
          // "1470" or "123") double-decodes it into a number and corrupts
          // the post. Only the Amplify GraphQL-client read path returns an
          // AWSJSON wire string and needs decodeAwsJson.
          body: row.body,
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
        // The cached value is the decrypted plaintext — not the
        // ciphertext — so repeated calls within one invocation never
        // re-decrypt or re-fetch.
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
              Key: marshall({ sk }),
            })
          )
          if (!result.Item) {
            secretCache.set(cacheKey, undefined)
            return undefined
          }
          const storedValue = unmarshall(result.Item).value as string | undefined
          if (!storedValue) {
            secretCache.set(cacheKey, undefined)
            return undefined
          }

          // Decrypt the ciphertext using the key read from the env var at
          // cold start (v2.2: file-based key, no SSM round-trip).
          // If the key is absent (not yet provisioned), fail closed and
          // return undefined. Never treat the stored value as plaintext:
          // v2.2 stores AES-GCM ciphertext here, and leaking that opaque
          // blob into plugin code makes misconfiguration harder to detect.
          const encryptionKey = getEncryptionKey()
          let plaintext: string | undefined
          if (encryptionKey) {
            try {
              plaintext = decryptSecret(encryptionKey, storedValue)
            } catch (decErr) {
              console.error(
                `[trusted-processor] ${label}: ctx.secret("${key}") decryption failed`,
                decErr
              )
              // Cache undefined so repeated calls don't retry a bad ciphertext.
              secretCache.set(cacheKey, undefined)
              return undefined
            }
          } else {
            // No encryption key — key not yet provisioned (fresh install) or
            // omitted from defineAmplessBackend({ pluginSecretEncryptionKey }).
            // Emit a warning so operators know to generate and configure the key.
            console.warn(
              `[trusted-processor] ${label}: ctx.secret("${key}") — no encryption key found; ` +
                `returning undefined. Run ` +
                '`npx create-ampless@beta setup-encryption-key` and rotate secrets.'
            )
            secretCache.set(cacheKey, undefined)
            return undefined
          }

          secretCache.set(cacheKey, plaintext)
          return plaintext as T | undefined
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
        // DynamoDBDocumentClient unmarshals AWSJSON-backed attributes into
        // native JS types (S→string, N→number, BOOL→boolean, M→object), so
        // `row.value` is ALREADY correctly typed here and must NOT be
        // re-parsed. Re-running JSON.parse on a native scalar string would
        // double-decode it (e.g. "1470" → number 1470), corrupting
        // numeric-looking string settings. Only the Amplify GraphQL-client
        // read path returns an AWSJSON wire string and needs decodeAwsJson.
        const raw = row.value
        settings[sk] = raw
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
          // Stable grep/alarm token. Keep the full `err` object as the
          // second arg so the stack trace is preserved in CloudWatch.
          console.error('[trusted-processor][ALERT] site-settings-cache rebuild failed', err)
          // Re-throw → SQS retry → DLQ after maxReceiveCount. Must be kept.
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

      for (const plugin of privilegedHookedPlugins) {
        if (plugin.hooks?.[parsed.type]) {
          console.warn(
            `[trusted-processor] privileged plugin "${plugin.name}" declares ` +
              `${parsed.type} hook but no privileged Lambda is provisioned yet — ` +
              `hook will not execute. See https://github.com/heavymoons/ampless/wiki/architecture-08-plugin-architecture.`
          )
        }
      }

      for (const plugin of trustedPlugins) {
        const hook = plugin.hooks?.[parsed.type]
        if (!hook) continue
        try {
          // Phase 1 reservation: hook return value (PluginHookResult)
          // is accepted by the type but ignored by the runtime. Future
          // directive semantics (e.g. metrics emission) will land with
          // their matching capability PRs.
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
