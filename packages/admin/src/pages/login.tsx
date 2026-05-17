import { LoginPage } from '../components/login-view.js'

/**
 * Login / sign-up / reset password page. The view is a client component
 * — this factory module stays server-side so `@ampless/admin/pages` can
 * be imported from Server Components and the `'use client'` boundary is
 * preserved at the cross-file reference.
 */
export function createLoginPage(_admin: unknown) {
  return LoginPage
}
