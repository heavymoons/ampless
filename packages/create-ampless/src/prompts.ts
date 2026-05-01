import * as p from '@clack/prompts'

export interface ProjectOptions {
  projectName: string
  siteName: string
  /** Themes to install. The first one is the default `theme.active`. */
  themes: string[]
  defaultTheme: string
  plugins: string[]
}

export async function runPrompts(argProjectName?: string): Promise<ProjectOptions | null> {
  p.intro('create-ampless')

  const result = await p.group(
    {
      projectName: () =>
        p.text({
          message: 'Project name',
          placeholder: 'my-ampless-site',
          defaultValue: argProjectName ?? 'my-ampless-site',
          validate: (v) => {
            if (!v.trim()) return 'Project name is required'
            if (!/^[a-z0-9-_]+$/.test(v)) return 'Use lowercase letters, numbers, hyphens, underscores'
          },
        }),

      siteName: () =>
        p.text({
          message: 'Site display name',
          placeholder: 'My Blog',
          defaultValue: 'My Blog',
        }),

      // Multiple themes can ship side-by-side. The first selected is the
      // default active theme; admins can switch per-site at runtime. Add
      // / remove themes later by editing themes-registry.ts and
      // themes/<name>/.
      themes: () =>
        p.multiselect({
          message: 'Themes to install (space to toggle)',
          options: [
            { value: 'blog', label: 'Blog — neutral monochrome (shadcn default)' },
            { value: 'minimal', label: 'Minimal — soft blue accent on warm neutral' },
          ],
          initialValues: ['blog', 'minimal'],
          required: true,
        }),

      plugins: () =>
        p.multiselect({
          message: 'Plugins (space to toggle)',
          options: [
            { value: 'seo', label: 'SEO — meta tags, OGP, sitemap', hint: 'recommended' },
            { value: 'rss', label: 'RSS — /feed.xml' },
            { value: 'webhook', label: 'Webhook — POST events to external URLs' },
          ],
          initialValues: ['seo'],
          required: false,
        }),
    },
    {
      onCancel: () => {
        p.cancel('Cancelled.')
        process.exit(0)
      },
    }
  )

  const themes = result.themes as string[]
  if (themes.length === 0) {
    p.cancel('At least one theme must be selected.')
    return null
  }

  const confirmed = await p.confirm({
    message: `Create project "${result.projectName}"?`,
    initialValue: true,
  })

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Cancelled.')
    return null
  }

  return {
    projectName: result.projectName as string,
    siteName: result.siteName as string,
    themes,
    defaultTheme: themes[0]!,
    plugins: result.plugins as string[],
  }
}
