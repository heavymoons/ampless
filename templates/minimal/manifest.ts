import { defineTheme } from 'ampless'

// Minimal theme: smaller customization surface than Blog by design.
// Minimal is opinionated about typography and spacing, so only the
// accent color and corner radius are exposed.
export default defineTheme({
  name: 'minimal',
  label: { en: 'Minimal', ja: 'ミニマル' },
  description: {
    en: 'Soft blue accent on warm-neutral background.',
    ja: '暖色系ニュートラル地にソフトブルーをアクセントとした構成。',
  },
  fields: [
    {
      key: 'primary',
      label: { en: 'Primary color', ja: 'プライマリカラー' },
      group: { en: 'Colors', ja: 'カラー' },
      type: 'color',
      default: 'oklch(0.55 0.18 250)',
      cssVar: '--primary',
      description: {
        en: 'Buttons, links, accent fills.',
        ja: 'ボタン、リンク、強調表示の背景色。',
      },
    },
    {
      key: 'radius',
      label: { en: 'Corner radius', ja: '角丸' },
      group: { en: 'Shape', ja: '形状' },
      type: 'length',
      default: '0.375rem',
      cssVar: '--radius',
    },
  ],
})
