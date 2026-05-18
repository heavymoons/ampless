import { spinner, outro, log } from '@clack/prompts'
import { existsSync } from 'fs'
import { basename, resolve } from 'path'
import { runPrompts, type ProjectOptions } from './prompts.js'
import { scaffold } from './scaffold.js'
import { sharedTemplateDir, templatesDir } from './templates.js'
import { parseDeployArgs, HELP_TEXT } from './args.js'
import { gatherDeployOptions } from './deploy-prompts.js'
import { runDeploy } from './deploy.js'
import pc from 'picocolors'

function buildNonInteractiveOpts(args: ReturnType<typeof parseDeployArgs>): ProjectOptions {
  // Resolve project name: CLI positional → directory basename → fallback
  const projectName =
    args.projectName ??
    (() => {
      const b = basename(process.cwd())
      return b && b !== '/' ? b : 'my-ampless-site'
    })()

  const siteName = args.siteName ?? 'My Blog'
  const themes = args.themes ?? ['blog']
  const plugins = args.plugins ?? ['seo']

  return {
    projectName,
    siteName,
    themes,
    defaultTheme: themes[0]!,
    plugins,
  }
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
    } catch (err) {
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
