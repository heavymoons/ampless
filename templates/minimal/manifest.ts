import { defineTheme } from 'ampless'

// Minimal theme: smaller customization surface than Blog by design.
// Minimal is opinionated about typography and spacing, so only the
// accent color and corner radius are exposed.
export default defineTheme({
  name: 'minimal',
  label: 'Minimal',
  description: 'Soft blue accent on warm-neutral background.',
  fields: [
    {
      key: 'primary',
      label: 'Primary color',
      group: 'Colors',
      type: 'color',
      default: 'oklch(0.55 0.18 250)',
      cssVar: '--primary',
      description: 'Buttons, links, accent fills.',
    },
    {
      key: 'radius',
      label: 'Corner radius',
      group: 'Shape',
      type: 'length',
      default: '0.375rem',
      cssVar: '--radius',
    },
  ],
})
