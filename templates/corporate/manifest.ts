import { defineTheme } from 'ampless'

// Corporate theme manifest. Conservative blue/slate palette with
// header + footer nav, an optional tagline, and a "news" section
// driven by published posts.
export default defineTheme({
  name: 'corporate',
  label: { en: 'Corporate', ja: 'コーポレート' },
  description: {
    en: 'Conservative business / company-site layout with hero and news section.',
    ja: '企業サイト向けの落ち着いたレイアウト。ヒーローとお知らせ一覧を併設。',
  },
  fields: [
    {
      key: 'tagline',
      label: { en: 'Tagline', ja: 'タグライン' },
      group: { en: 'Hero', ja: 'ヒーロー' },
      type: 'text',
      default: '',
      maxLength: 120,
      description: {
        en: 'Short phrase shown above the site name in the hero.',
        ja: 'ヒーロー内、サイト名の上に表示される短いフレーズ。',
      },
    },
    {
      key: 'primary',
      label: { en: 'Primary color', ja: 'プライマリカラー' },
      group: { en: 'Colors', ja: 'カラー' },
      type: 'color',
      default: 'oklch(0.4 0.13 250)',
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
      key: 'featuredSlug',
      label: { en: 'Top story slug', ja: 'トップストーリーのスラッグ' },
      group: { en: 'Hero', ja: 'ヒーロー' },
      type: 'text',
      default: '',
      maxLength: 200,
      description: {
        en: 'Slug of a published post to feature between the hero and the news list. Empty disables.',
        ja: 'ヒーローとニュース一覧の間に載せたい公開記事のスラッグ。空なら非表示。',
      },
    },
    {
      key: 'logoUrl',
      label: { en: 'Logo image URL', ja: 'ロゴ画像 URL' },
      group: { en: 'Branding', ja: 'ブランディング' },
      type: 'image',
      default: '',
      description: {
        en: 'URL or media path. Empty falls back to the site name as text.',
        ja: '画像 URL またはメディアパス。空欄ならサイト名がテキスト表示されます。',
      },
    },
    {
      key: 'headerNav',
      label: { en: 'Header navigation', ja: 'ヘッダーナビ' },
      group: { en: 'Navigation', ja: 'ナビゲーション' },
      type: 'linkList',
      default: [],
      maxItems: 8,
    },
    {
      key: 'footerLinks',
      label: { en: 'Footer links', ja: 'フッターリンク' },
      group: { en: 'Navigation', ja: 'ナビゲーション' },
      type: 'linkList',
      default: [],
      maxItems: 16,
    },
    {
      key: 'footerLegend',
      label: { en: 'Footer legend', ja: 'フッター注記' },
      group: { en: 'Navigation', ja: 'ナビゲーション' },
      type: 'text',
      default: '',
      maxLength: 200,
      description: {
        en: 'Address / company info / extra small print below footer links.',
        ja: '住所や会社情報、フッター下部の細字。',
      },
    },
  ],
})
