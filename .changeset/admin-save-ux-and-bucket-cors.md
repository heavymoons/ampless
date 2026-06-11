---
"@ampless/backend": patch
"@ampless/admin": patch
---

Fix three dogfood-confirmed bugs in one batch:

**A. Bucket CORS (admin media delete / large-file upload broken)**
The custom CORS rule (`GET`/`HEAD` only) was clobbering Amplify Storage's default allowed-methods set. This caused two symptoms: (1) admin browser-direct `DELETE` calls (`remove()`) were blocked at the CORS preflight — media deletion always failed; (2) multipart upload completion requires reading each part's `ETag` response header, which was not in `exposedHeaders`, so the Amplify Storage SDK could not assemble the final object and large uploads silently stalled. Fixed by extending `allowedMethods` to `['GET','HEAD','PUT','POST','DELETE']` and adding `exposedHeaders`. CORS grants no permissions — IAM and bucket policy continue to gate writes to Cognito-authenticated identities.

**User sites:** pick up the fix via `deps` update + next deploy. CloudFormation updates bucket CORS in-place — no data risk.

**B. Honest no-op saves**
`save()` wrote only touched fields but still showed "Saved" and triggered cache invalidation even when zero fields were written (e.g. clicking Save with no changes). Worse, it cleared the entire `touched` map on success, silently dropping edits for fields that were touched but skipped (e.g. an empty number field). Fixed: write-collection is now a testable pure function (`collectSettingWrites`); zero-write saves show a new `plugins.noChanges` info message and skip cache invalidation; on success, only the actually-written keys are removed from `touched`.

**C. Mount-time settings refresh from DDB**
The admin form initialised from an S3 snapshot (`revalidate: 60`), so after saving, a page reload showed the pre-save value for up to ~70 s ("the value disappeared"). Fixed by adding a mount-time `useEffect` that reads all public fields directly from DDB (strongly consistent) via a new `getPluginPublicSetting` helper, updating only non-touched fields so in-flight edits are never clobbered.
