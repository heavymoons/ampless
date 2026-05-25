---
'@ampless/backend': patch
---

Fix theme switches (and any other site-setting change) silently failing
to propagate to the public site.

The trusted processor Lambda writes the site-settings cache to
`s3://<bucket>/public/site-settings.json`, but its IAM PutObject grant
was still scoped to `public/site-settings/*` — a leftover from the
multi-site era when the file lived at `public/site-settings/<siteId>.json`.

AWS IAM wildcards treat `/` as a literal character, so the pattern
`prefix/*` matches `prefix/foo.json` but does NOT match `prefix.json`.
After the multi-site removal (#93) the path collapsed to a single
file `public/site-settings.json`, but the IAM resource pattern wasn't
updated — every PutObject failed silently with AccessDenied. The
result: KvStore had the user's edits, but `public/site-settings.json`
in S3 was never created/updated, so the public site (and the admin
on next render) always fell back to the registry's default theme
and default settings.

Symptoms reported: admin theme switch shows the new theme briefly
(via optimistic UI + iframe `?previewTheme=` preview), then the
8-second post-save hard-reload renders the old default theme and
stays there even on subsequent reloads. CloudWatch on the trusted
processor would show `AccessDenied` on the `s3:PutObject` call;
post-cooldown the SQS message lands in the DLQ.

Fix: tighten the resource to the exact key `public/site-settings.json`.
Comment updated to call out the historical pitfall.
