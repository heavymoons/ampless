import { loadConfig } from './config.js'
import { startServer } from './server.js'

async function main(): Promise<void> {
  const config = await loadConfig()
  await startServer(config)
}

main().catch((err) => {
  // stderr only — MCP stdio uses stdout for JSON-RPC frames, so any log on
  // stdout would corrupt the protocol.
  console.error(err instanceof Error ? err.stack ?? err.message : String(err))
  process.exit(1)
})
