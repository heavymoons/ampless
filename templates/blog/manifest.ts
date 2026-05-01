import { defineTheme } from 'ampless'

// Customizable fields for the Blog theme. Edit values in
// `/admin/sites/<siteId>/theme` — they're stored in KvStore and applied
// at render time as CSS variables on every public page.
//
// Labels / descriptions / groups accept either a plain string (works in
// any locale) or a `Record<locale, string>` map. The defaults ship in
// English + Japanese; custom themes can mix both forms.
export default defineTheme({
  name: 'blog',
  label: { en: 'Blog', ja: 'ブログ' },
  description: {
    en: 'Neutral monochrome with shadcn/ui defaults.',
    ja: 'シャドCN/UIのデフォルトに準じたニュートラル系モノクロ。',
  },
  fields: [
    {
      key: 'primary',
      label: { en: 'Primary color', ja: 'プライマリカラー' },
      group: { en: 'Colors', ja: 'カラー' },
      type: 'color',
      default: 'oklch(0.205 0 0)',
      cssVar: '--primary',
      description: {
        en: 'Buttons, links, accent fills.',
        ja: 'ボタン、リンク、強調表示の背景色。',
      },
    },
    {
      key: 'accent',
      label: { en: 'Accent color', ja: 'アクセントカラー' },
      group: { en: 'Colors', ja: 'カラー' },
      type: 'color',
      default: 'oklch(0.97 0 0)',
      cssVar: '--accent',
    },
    {
      key: 'ring',
      label: { en: 'Focus ring', ja: 'フォーカスリング' },
      group: { en: 'Colors', ja: 'カラー' },
      type: 'color',
      default: 'oklch(0.708 0 0)',
      cssVar: '--ring',
    },
    {
      key: 'destructive',
      label: { en: 'Destructive', ja: '破壊的操作' },
      group: { en: 'Colors', ja: 'カラー' },
      type: 'color',
      default: 'oklch(0.577 0.245 27.325)',
      cssVar: '--destructive',
      description: {
        en: 'Delete buttons and error highlights.',
        ja: '削除ボタンやエラー表示の色。',
      },
    },
    {
      key: 'radius',
      label: { en: 'Corner radius', ja: '角丸' },
      group: { en: 'Shape', ja: '形状' },
      type: 'length',
      default: '0.5rem',
      cssVar: '--radius',
      description: {
        en: 'Border radius for cards, buttons, inputs.',
        ja: 'カード、ボタン、入力欄の角丸。',
      },
    },
    {
      key: 'bodyFont',
      label: { en: 'Body font', ja: '本文フォント' },
      group: { en: 'Typography', ja: 'タイポグラフィ' },
      type: 'fontFamily',
      default: 'system-ui, -apple-system, sans-serif',
      cssVar: '--ampless-body-font',
      options: [
        {
          value: 'system-ui, -apple-system, sans-serif',
          label: { en: 'System sans', ja: 'システムサンセリフ' },
        },
        {
          value: 'Georgia, "Times New Roman", serif',
          label: { en: 'Serif (Georgia)', ja: 'セリフ (Georgia)' },
        },
        {
          value: '"Iowan Old Style", "Apple Garamond", serif',
          label: { en: 'Serif (Iowan)', ja: 'セリフ (Iowan)' },
        },
        {
          value: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          label: { en: 'Monospace', ja: '等幅' },
        },
      ],
    },
    {
      key: 'headerNav',
      label: { en: 'Header navigation', ja: 'ヘッダーナビ' },
      group: { en: 'Navigation', ja: 'ナビゲーション' },
      type: 'linkList',
      default: [],
      maxItems: 8,
      description: {
        en: 'Optional. When empty, the header is omitted entirely.',
        ja: '任意。空の場合はヘッダー自体が表示されません。',
      },
    },
    {
      key: 'footerLinks',
      label: { en: 'Footer links', ja: 'フッターリンク' },
      group: { en: 'Navigation', ja: 'ナビゲーション' },
      type: 'linkList',
      default: [],
      maxItems: 12,
      description: {
        en: 'Optional. When empty and no copyright text exists, the footer is omitted.',
        ja: '任意。空の場合はフッター自体が省略されます。',
      },
    },
  ],
})
