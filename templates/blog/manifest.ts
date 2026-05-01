import { defineTheme } from 'ampless'

// Customizable fields for the Blog theme. Edit values in
// `/admin/sites/<siteId>/theme` — they're stored in KvStore and applied
// at render time as CSS variables on every public page.
//
// Fields with `cssVar` set are injected into a `:root` style block.
// Fields without `cssVar` are available to template code via
// `loadThemeConfig(siteId)`.
export default defineTheme({
  name: 'blog',
  label: 'Blog',
  description: 'Neutral monochrome with shadcn/ui defaults.',
  fields: [
    {
      key: 'primary',
      label: 'Primary color',
      group: 'Colors',
      type: 'color',
      default: 'oklch(0.205 0 0)',
      cssVar: '--primary',
      description: 'Buttons, links, accent fills.',
    },
    {
      key: 'accent',
      label: 'Accent color',
      group: 'Colors',
      type: 'color',
      default: 'oklch(0.97 0 0)',
      cssVar: '--accent',
    },
    {
      key: 'ring',
      label: 'Focus ring',
      group: 'Colors',
      type: 'color',
      default: 'oklch(0.708 0 0)',
      cssVar: '--ring',
    },
    {
      key: 'destructive',
      label: 'Destructive',
      group: 'Colors',
      type: 'color',
      default: 'oklch(0.577 0.245 27.325)',
      cssVar: '--destructive',
      description: 'Delete buttons and error highlights.',
    },
    {
      key: 'radius',
      label: 'Corner radius',
      group: 'Shape',
      type: 'length',
      default: '0.5rem',
      cssVar: '--radius',
      description: 'Border radius for cards, buttons, inputs.',
    },
    {
      key: 'bodyFont',
      label: 'Body font',
      group: 'Typography',
      type: 'fontFamily',
      default: 'system-ui, -apple-system, sans-serif',
      cssVar: '--ampless-body-font',
      options: [
        { value: 'system-ui, -apple-system, sans-serif', label: 'System sans' },
        { value: 'Georgia, "Times New Roman", serif', label: 'Serif (Georgia)' },
        { value: '"Iowan Old Style", "Apple Garamond", serif', label: 'Serif (Iowan)' },
        {
          value: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          label: 'Monospace',
        },
      ],
    },
  ],
})
