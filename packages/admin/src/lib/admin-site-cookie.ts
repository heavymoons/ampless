// Plain string constant for the admin site selector cookie name.
// Kept in its own directive-less module so both server-side
// (`lib/admin-site.ts`, reading the cookie via `next/headers`) and
// client-side (`lib/admin-site-client.ts`, writing it via
// `document.cookie`) consumers can import it without dragging a
// `'use client'` boundary across the import edge.

export const ADMIN_SITE_COOKIE = 'admin-site-id'
