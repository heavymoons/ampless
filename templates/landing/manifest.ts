import { defineTheme } from 'ampless'

// Landing theme manifest. The home page is hero-led; posts (if any)
// show up as a "latest" section beneath. Most fields are content
// rather than chrome — admins fill in the marketing copy.
export default defineTheme({
  name: 'landing',
  label: { en: 'Landing', ja: 'ランディング' },
  description: {
    en: 'Single-page hero focus, optional features and post list.',
    ja: '1 ページ完結型のヒーロー中心レイアウト。お知らせ一覧も併設可能。',
  },
  fields: [
    {
      key: 'heroHeadline',
      label: { en: 'Hero headline', ja: 'ヒーロー見出し' },
      group: { en: 'Hero', ja: 'ヒーロー' },
      type: 'text',
      default: '',
      maxLength: 120,
      description: {
        en: 'Empty falls back to the site name.',
        ja: '空欄の場合はサイト名を使用。',
      },
    },
    {
      key: 'heroSubheadline',
      label: { en: 'Hero subheadline', ja: 'ヒーローサブ見出し' },
      group: { en: 'Hero', ja: 'ヒーロー' },
      type: 'text',
      default: '',
      maxLength: 200,
      description: {
        en: 'Empty falls back to the site description.',
        ja: '空欄の場合はサイトの説明を使用。',
      },
    },
    {
      key: 'ctaText',
      label: { en: 'CTA button text', ja: 'CTA ボタンのテキスト' },
      group: { en: 'Hero', ja: 'ヒーロー' },
      type: 'text',
      default: '',
      maxLength: 40,
      description: {
        en: 'Leave empty to hide the call-to-action button.',
        ja: '空欄にするとボタンを非表示。',
      },
    },
    {
      key: 'ctaUrl',
      label: { en: 'CTA URL', ja: 'CTA リンク先' },
      group: { en: 'Hero', ja: 'ヒーロー' },
      type: 'text',
      default: '#',
      maxLength: 200,
    },
    {
      key: 'primary',
      label: { en: 'Primary color', ja: 'プライマリカラー' },
      group: { en: 'Colors', ja: 'カラー' },
      type: 'color',
      default: 'oklch(0.6 0.18 35)',
      cssVar: '--primary',
      description: {
        en: 'Hero accent and CTA button background.',
        ja: 'ヒーロー強調色と CTA ボタンの背景色。',
      },
    },
    {
      key: 'radius',
      label: { en: 'Corner radius', ja: '角丸' },
      group: { en: 'Shape', ja: '形状' },
      type: 'length',
      default: '0.75rem',
      cssVar: '--radius',
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
      maxItems: 12,
    },
  ],
})
