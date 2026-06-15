import { describe, it, expect } from 'vitest'
import { siteSettingsCacheS3Resources } from './backend.js'

// Regression guard for the trusted-processor S3 grant.
//
// rebuildSiteSettingsCache PutObjects a single file at the exact key
// `public/site-settings.json`. The IAM resource list must contain that
// EXACT ARN — a wildcard like `public/site-settings/*` would NOT match
// the single-file key, and the PutObject would fail silently with
// AccessDenied, so the public site would never see admin-side theme /
// settings changes. This test fails loudly if the exact-match ARN is ever
// dropped or replaced with a non-matching wildcard.
describe('siteSettingsCacheS3Resources', () => {
  const bucketArn = 'arn:aws:s3:::bucket'

  it('includes the exact-match site-settings.json ARN', () => {
    expect(siteSettingsCacheS3Resources(bucketArn)).toContain(
      'arn:aws:s3:::bucket/public/site-settings.json'
    )
  })

  it('includes the bucket-wide plugin-assets prefix', () => {
    expect(siteSettingsCacheS3Resources(bucketArn)).toContain(
      'arn:aws:s3:::bucket/public/plugins/*'
    )
  })

  it('does not substitute a non-matching wildcard for the single-file key', () => {
    const resources = siteSettingsCacheS3Resources(bucketArn)
    // A wildcard like `public/site-settings/*` does NOT match the
    // single-file key `public/site-settings.json`.
    expect(resources).not.toContain('arn:aws:s3:::bucket/public/site-settings/*')
  })
})
