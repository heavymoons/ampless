import { defineTheme } from 'ampless'

// Docs theme manifest. Sidebar-led layout where the sidebar can mix
// plain links with tag-driven sections — `tag:guide` expands to a
// list of every published post tagged "guide". Lets users organize
// content by tag and have it appear automatically in the nav.
export default defineTheme({
  name: 'docs',
  label: { en: 'Docs', ja: 'ドキュメント' },
  description: {
    en: 'Sidebar-led documentation layout. Sidebar entries can be plain links or `tag:<name>` to auto-expand into a post list.',
    ja: 'サイドバー型のドキュメントレイアウト。サイドバー項目は通常のリンクか、`tag:<name>` 指定でそのタグの記事一覧に自動展開可能。',
  },
  fields: [
    {
      key: 'primary',
      label: { en: 'Primary color', ja: 'プライマリカラー' },
      group: { en: 'Colors', ja: 'カラー' },
      type: 'color',
      default: 'oklch(0.5 0.18 280)',
      cssVar: '--primary',
    },
    {
      key: 'radius',
      label: { en: 'Corner radius', ja: '角丸' },
      group: { en: 'Shape', ja: '形状' },
      type: 'length',
      default: '0.25rem',
      cssVar: '--radius',
    },
    {
      key: 'codeFont',
      label: { en: 'Code font', ja: 'コードフォント' },
      group: { en: 'Typography', ja: 'タイポグラフィ' },
      type: 'fontFamily',
      default: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      cssVar: '--ampless-code-font',
      options: [
        {
          value: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          label: { en: 'System monospace', ja: 'システム等幅' },
        },
        {
          value: '"JetBrains Mono", ui-monospace, monospace',
          label: { en: 'JetBrains Mono', ja: 'JetBrains Mono' },
        },
      ],
    },
    {
      key: 'sidebarNav',
      label: { en: 'Sidebar navigation', ja: 'サイドバーナビ' },
      group: { en: 'Navigation', ja: 'ナビゲーション' },
      type: 'linkList',
      default: [],
      maxItems: 30,
      description: {
        en: 'Each entry is a plain link or `tag:<name>` (auto-lists posts with that tag).',
        ja: '通常のリンクか、`tag:<name>` 指定でそのタグの記事一覧を自動展開。',
      },
    },
    {
      key: 'headerNav',
      label: { en: 'Header navigation', ja: 'ヘッダーナビ' },
      group: { en: 'Navigation', ja: 'ナビゲーション' },
      type: 'linkList',
      default: [],
      maxItems: 6,
    },
    {
      key: 'footerLinks',
      label: { en: 'Footer links', ja: 'フッターリンク' },
      group: { en: 'Navigation', ja: 'ナビゲーション' },
      type: 'linkList',
      default: [],
      maxItems: 12,
    },
  ],
})
