import { spinner, outro, log } from '@clack/prompts'
import { existsSync } from 'fs'
import { basename, resolve } from 'path'
import { runPrompts, type ProjectOptions } from './prompts.js'
import { scaffold } from './scaffold.js'
import { sharedTemplateDir, templatesDir } from './templates.js'
import { parseDeployArgs, HELP_TEXT, VALID_THEMES, type ParsedArgs } from './args.js'
import { gatherDeployOptions } from './deploy-prompts.js'
import { runDeploy, PreflightError } from './deploy.js'
import { validateMountableProject } from './mount.js'
import { runUpgrade } from './upgrade.js'
import { runCopyTheme } from './copy-theme.js'
import pc from 'picocolors'

// Default scaffolds install every shipped theme so the
// themes-registry.ts placeholder compiles without manual fixup, and
// projects can prototype theme switching from day one. Users who want
// a leaner install run with --themes=<comma-separated>.
const DEFAULT_THEMES: readonly string[] = VALID_THEMES

function buildNonInteractiveOpts(args: ReturnType<typeof parseDeployArgs>): ProjectOptions {
  // Resolve project name: CLI positional → directory basename → fallback
  const projectName =
    args.projectName ??
    (() => {
      const b = basename(process.cwd())
      return b && b !== '/' ? b : 'my-ampless-site'
    })()

  const siteName = args.siteName ?? 'My Blog'
  const themes = args.themes ?? [...DEFAULT_THEMES]
  const plugins = args.plugins ?? ['seo']

  return {
    projectName,
    siteName,
    themes,
    defaultTheme: themes[0]!,
    plugins,
  }
}

function warnIgnoredScaffoldFlags(args: ParsedArgs): void {
  const ignored: string[] = []
  if (args.siteName) ignored.push('--site-name')
  if (args.themes) ignored.push('--themes')
  if (args.plugins) ignored.push('--plugins')
  if (args.projectName) ignored.push('<project-name> positional')
  if (ignored.length > 0) {
    log.warn(`--mount mode ignores: ${ignored.join(', ')}`)
  }
}

async function runMount(args: ParsedArgs): Promise<void> {
  const destDir = process.cwd()
  const projectName = basename(destDir)

  warnIgnoredScaffoldFlags(args)

  const problem = validateMountableProject(destDir)
  if (problem) {
    log.error(problem)
    log.info(
      'Run `npx create-ampless@alpha <name>` first to scaffold, or `cd` into a scaffolded project before passing --mount.'
    )
    process.exit(1)
  }

  const deployOpts = await gatherDeployOptions(args, destDir, projectName)
  if (!deployOpts) return

  try {
    const result = await runDeploy({ ...deployOpts, mount: true })
    printDeployResult(result)
  } catch (err) {
    if (err instanceof PreflightError) {
      process.exit(1)
    }
    log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

function printDeployResult(result: import('./deploy.js').DeployResult): void {
  const lines = [
    `${pc.green('✔')} Project deployed`,
    ``,
    `  GitHub:        ${pc.cyan(result.githubRepoUrl)}`,
    `  Amplify app:   ${pc.cyan(result.amplifyAppId)}`,
    `  Amplify URL:   ${pc.cyan(result.amplifyAppUrl)}`,
  ]
  if (result.domainUrl) {
    lines.push(`  Custom domain: ${pc.cyan(result.domainUrl)}`)
  }
  if (result.domainVerification && result.domainVerification.length > 0) {
    lines.push('', `  ${pc.bold('Add these DNS records to verify the domain:')}`)
    for (const v of result.domainVerification) {
      lines.push(`    ${v.cname}  CNAME  ${v.target}`)
    }
  }
  lines.push(
    '',
    `  First build is now running in Amplify Hosting.`,
    `  Watch it at ${pc.cyan(`https://console.aws.amazon.com/amplify/home#/${result.amplifyAppId}`)}`
  )
  outro(lines.join('\n'))
}

async function main() {
  const args = parseDeployArgs(process.argv.slice(2))

  if (args.help) {
    process.stdout.write(HELP_TEXT)
    return
  }
  for (const flag of args.unknown) {
    log.warn(`Unknown argument ignored: ${flag}`)
  }

  if (args.upgrade) {
    await runUpgrade(args)
    return
  }

  if (args.copyTheme) {
    await runCopyTheme(args)
    return
  }

  if (args.mount) {
    await runMount(args)
    return
  }

  let opts: ProjectOptions | null
  if (args.skipConfirm) {
    opts = buildNonInteractiveOpts(args)
  } else {
    opts = await runPrompts(args.projectName)
  }
  if (!opts) return

  const destDir = resolve(process.cwd(), opts.projectName)

  if (existsSync(destDir)) {
    log.error(`Directory already exists: ${destDir}`)
    process.exit(1)
  }

  const sharedDir = sharedTemplateDir()
  const s = spinner()
  s.start('Scaffolding project...')

  try {
    await scaffold(sharedDir, templatesDir, destDir, opts)
    s.stop('Done!')
  } catch (err) {
    s.stop('Failed.')
    log.error(String(err))
    process.exit(1)
  }

  if (args.deploy) {
    const deployOpts = await gatherDeployOptions(args, destDir, opts.projectName)
    if (!deployOpts) return

    try {
      const result = await runDeploy(deployOpts)
      printDeployResult(result)
    } catch (err) {
      if (err instanceof PreflightError) {
        // Report is already printed by runDeploy; just exit cleanly.
        process.exit(1)
      }
      log.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
    return
  }

  outro(
    `${pc.green('✔')} Project created at ${pc.bold(opts.projectName)}\n\n` +
    `  Next steps:\n` +
    `    ${pc.cyan('cd')} ${opts.projectName}\n` +
    `    ${pc.cyan('npm install')}\n` +
    `    ${pc.cyan('npx ampx sandbox')}   ${pc.dim('# start Amplify backend')}\n` +
    `    ${pc.cyan('npm run dev')}         ${pc.dim('# start Next.js')}`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
