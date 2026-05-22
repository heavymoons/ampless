// `@ampless/admin/components` — optional escape hatch for projects
// that want to embed admin form components (post-form, site-settings-form,
// theme-settings-form, media-uploader) outside the bundled admin pages.
// Most consumers don't need this — the `@ampless/admin/pages` factories
// already wire everything up. Surfaces stay minimal so the public API
// surface for v0.1 stays small and overridable later.

export { I18nProvider, useT, useLocale } from './i18n-provider.js'
export { AdminProviders } from './admin-providers.js'
// Admin-only `*-view` page bodies (`AdminDashboard`, `LoginPage`,
// `PostsList`, etc.) intentionally stay OUT of this barrel. They are
// internal to `@ampless/admin/pages`'s page factories and are split
// into their own dist chunks via private `tsup.config.ts` entries —
// see the `Private chunks for admin-only views` block there. This
// keeps the public escape hatch surface focused on reusable
// widgets / utilities (forms, providers, media helpers) instead of
// opinionated admin pages.
export { publicMediaUrl, setAdminMediaContext } from '../lib/media.js'
export { uploadProcessedImage, sanitizeName } from '../lib/upload.js'
export { invalidateSiteSettingsCache } from '../lib/theme-actions.js'
export { Sidebar } from './sidebar.js'
export { PostForm } from './post-form.js'
export { SiteSettingsForm, type SiteSettingsFormValues } from './site-settings-form.js'
export { ThemeSettingsForm } from './theme-settings-form.js'
export { MediaUploader } from './media-uploader.js'
export { MediaPicker } from './media-picker.js'
export { ImageUploadDialog, type ImageUploadDialogProps } from './image-upload-dialog.js'
