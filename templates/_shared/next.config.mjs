/** @type {import('next').NextConfig} */
const nextConfig = {
  // ampless serves `format: 'static'` posts at `/<slug>/` (trailing slash)
  // so the bundle's relative asset paths resolve against `/<slug>/...`.
  // The static route 308-redirects `/<slug>` → `/<slug>/`; Next's default
  // trailing-slash normalization does the opposite (`/<slug>/` → `/<slug>`),
  // and the two fight into an infinite redirect loop. Letting middleware /
  // the static route own trailing-slash handling avoids it. Do not remove.
  skipTrailingSlashRedirect: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.s3.amazonaws.com' },
      { protocol: 'https', hostname: '*.amazonaws.com' },
    ],
  },
}

export default nextConfig
