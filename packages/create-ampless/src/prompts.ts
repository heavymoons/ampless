import * as p from '@clack/prompts'

export interface ProjectOptions {
  projectName: string
  siteName: string
  theme: string
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

      theme: () =>
        p.select({
          message: 'Theme',
          options: [{ value: 'blog', label: 'Blog' }],
          initialValue: 'blog',
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

  const confirmed = await p.confirm({
    message: `Create project "${result.projectName}"?`,
    initialValue: true,
  })

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel('Cancelled.')
    return null
  }

  return result as ProjectOptions
}
