import { spinner, outro, log } from '@clack/prompts'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { runPrompts } from './prompts.js'
import { scaffold } from './scaffold.js'
import { sharedTemplateDir, templatePath } from './templates.js'
import pc from 'picocolors'

async function main() {
  const argProjectName = process.argv[2]

  const opts = await runPrompts(argProjectName)
  if (!opts) return

  const destDir = resolve(process.cwd(), opts.projectName)

  if (existsSync(destDir)) {
    log.error(`Directory already exists: ${destDir}`)
    process.exit(1)
  }

  const sharedDir = sharedTemplateDir()
  const themeDir = templatePath(opts.theme)
  const s = spinner()
  s.start('Scaffolding project...')

  try {
    await scaffold(sharedDir, themeDir, destDir, opts)
    s.stop('Done!')
  } catch (err) {
    s.stop('Failed.')
    log.error(String(err))
    process.exit(1)
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
