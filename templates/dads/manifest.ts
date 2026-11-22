import { defineTheme } from 'ampless'

// DADS (Digital Agency Design System) — デジタル庁デザインシステム準拠
// テーマ。政府 / 自治体 / 公共系サイト向け。視覚的特徴: 高コントラス
// ト、明朝寄りの本文、控えめな装飾、日付や出典の明示、アクセシビリティ
// 重視。
//
// カスタマイズ surface はあえて狭め。DADS は「色を自由に変えると準拠
// しなくなる」性質のシステムなので、ユーザーがロゴ / ナビ / 簡素な
// アクセント色程度を触れる範囲に限定。primary は solidBlue 系を
// 強く推奨 (description に注意書き)。
export default defineTheme({
  name: 'dads',
  label: { en: 'DADS', ja: 'デジタル庁デザインシステム' },
  description: {
    en: 'Government / public-sector layout following the Digital Agency Design System aesthetic. High contrast, accessibility-first, minimal decoration.',
    ja: 'デジタル庁デザインシステム準拠のレイアウト。政府・自治体・公共系サイト向け。高コントラスト、アクセシビリティ重視、装飾控えめ。',
  },
  fields: [
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
      key: 'primary',
      label: { en: 'Primary color', ja: 'プライマリカラー' },
      group: { en: 'Colors', ja: 'カラー' },
      type: 'color',
      default: 'oklch(0.34 0.18 264)',
      cssVar: '--primary',
      description: {
        en: 'Defaults to DADS solidBlue (#0017c1 equivalent). Changing to a non-DADS color makes the site no longer DADS-compliant.',
        ja: 'デフォルトは DADS solidBlue (#0017c1 相当)。DADS 仕様外の色に変更すると DADS 準拠ではなくなります。',
      },
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
      maxLength: 300,
      description: {
        en: 'Organization name / address / responsibility statement shown below the footer links.',
        ja: '組織名・所在地・責任者名など、フッター下部に表示する細字。',
      },
    },
  ],
})
