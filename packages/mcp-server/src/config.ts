import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AmplifyOutputs, ResolvedConfig } from './types.js'

interface ParsedArgs {
  outputs?: string
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--outputs' || arg === '-o') {
      out.outputs = argv[++i]
    } else if (arg.startsWith('--outputs=')) {
      out.outputs = arg.slice('--outputs='.length)
    }
  }
  return out
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`mcp-server: missing required env var ${name}`)
  return v
}

export async function loadConfig(argv: string[] = process.argv.slice(2)): Promise<ResolvedConfig> {
  const args = parseArgs(argv)
  const outputsPath = args.outputs ?? process.env.AMPLESS_MCP_OUTPUTS
  if (!outputsPath) {
    throw new Error(
      'mcp-server: pass --outputs <path-to-amplify_outputs.json> or set AMPLESS_MCP_OUTPUTS'
    )
  }

  const absolute = resolve(outputsPath)
  let raw: string
  try {
    raw = await readFile(absolute, 'utf-8')
  } catch (err) {
    throw new Error(`mcp-server: cannot read outputs file at ${absolute} (${(err as Error).message})`)
  }

  let outputs: AmplifyOutputs
  try {
    outputs = JSON.parse(raw) as AmplifyOutputs
  } catch (err) {
    throw new Error(`mcp-server: invalid JSON in ${absolute} (${(err as Error).message})`)
  }

  if (!outputs.auth?.user_pool_id || !outputs.auth?.user_pool_client_id) {
    throw new Error('mcp-server: outputs.auth.user_pool_id / user_pool_client_id missing')
  }
  if (!outputs.data?.url) {
    throw new Error('mcp-server: outputs.data.url missing')
  }

  return {
    outputs,
    email: requireEnv('AMPLESS_MCP_EMAIL'),
    password: requireEnv('AMPLESS_MCP_PASSWORD'),
  }
}
