import {
  AppSyncClient,
  ListApiKeysCommand,
  UpdateApiKeyCommand,
} from '@aws-sdk/client-appsync'

// Monthly job: pin every AppSync API key on this API to "expires ~365
// days from now" so the public site never silently 401s on key expiry.
//
// AppSync caps `expires` at exactly 365 days; we use 364 to leave a
// small margin and avoid `BadRequestException` on edge cases.
//
// Updates the existing key (same id), so amplify_outputs.json values
// stay valid and Next.js does not need a rebuild.

const client = new AppSyncClient({})

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`api-key-renewer: missing required env var ${name}`)
  return v
}

const APPSYNC_API_ID = requireEnv('APPSYNC_API_ID')
const TTL_DAYS = 364

/**
 * EventBridge-triggered Lambda that rolls every AppSync API key on
 * this API forward to `now + 364 days`. Re-exported by the template's
 * thin shell `amplify/functions/api-key-renewer/handler.ts`.
 */
export const handler = async () => {
  const { apiKeys } = await client.send(
    new ListApiKeysCommand({ apiId: APPSYNC_API_ID })
  )
  if (!apiKeys || apiKeys.length === 0) {
    console.warn('[api-key-renewer] no api keys to renew')
    return
  }

  const expires = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400
  const targetIso = new Date(expires * 1000).toISOString()

  for (const k of apiKeys) {
    if (!k.id) continue
    const beforeIso = k.expires ? new Date(k.expires * 1000).toISOString() : '(none)'
    await client.send(
      new UpdateApiKeyCommand({
        apiId: APPSYNC_API_ID,
        id: k.id,
        expires,
      })
    )
    console.log(`[api-key-renewer] ${k.id}: ${beforeIso} -> ${targetIso}`)
  }
}
