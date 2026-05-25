export interface ResolvedSite {
  name: string
  url?: string
  environment: 'prod' | 'stg' | 'dev'
  siteId: string
}

export function buildServerName(site: ResolvedSite | undefined): string {
  if (!site) return '@ampless/mcp-server'
  return `@ampless/mcp-server [${site.name}/${site.environment}]`
}

interface ToolEntry {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  destructive?: boolean
}

interface DecoratedTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export function decorateToolListing(
  tools: ToolEntry[],
  site: ResolvedSite | undefined
): DecoratedTool[] {
  if (!site) {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }))
  }

  return tools.map((t) => {
    const isProdDestructive = t.destructive === true && site.environment === 'prod'
    const envLabel = site.environment === 'prod' ? 'PROD' : site.environment

    let description: string
    if (isProdDestructive) {
      description = `[${site.name} / ${envLabel} — destructive] ${t.description} Requires confirmSite: "${site.name}".`
    } else if (t.destructive) {
      description = `[${site.name} / ${envLabel} — destructive] ${t.description}`
    } else {
      description = `[${site.name} / ${site.environment}] ${t.description}`
    }

    let inputSchema = t.inputSchema
    if (isProdDestructive) {
      const cloned = JSON.parse(JSON.stringify(t.inputSchema)) as Record<string, unknown>
      const props = (cloned.properties ?? {}) as Record<string, unknown>
      props['confirmSite'] = {
        type: 'string',
        const: site.name,
        description: `Must equal "${site.name}" to confirm this destructive operation on the production site.`,
      }
      cloned.properties = props

      const existing = (cloned.required ?? []) as string[]
      cloned.required = ['confirmSite', ...existing]
      inputSchema = cloned
    }

    return { name: t.name, description, inputSchema }
  })
}

export function assertConfirmSite(
  tool: ToolEntry,
  args: Record<string, unknown>,
  site: ResolvedSite | undefined
): void {
  if (!site || site.environment !== 'prod' || !tool.destructive) return
  if (args['confirmSite'] !== site.name) {
    throw new Error(
      `confirmSite mismatch: expected "${site.name}", got ${JSON.stringify(args['confirmSite'])}. Pass confirmSite: "${site.name}" to confirm this destructive operation on the production site.`
    )
  }
}

export function wrapResult(
  result: unknown,
  site: ResolvedSite | undefined
): unknown {
  if (!site) return result
  return { site, result }
}
