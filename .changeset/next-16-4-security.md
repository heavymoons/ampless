---
"create-ampless": patch
"@ampless/admin": patch
"@ampless/runtime": patch
---

Bump `next` to `^16.4.6` to address critical unauthenticated RCE advisories affecting every Next.js 16.x release below 16.4.1 (GHSA-673q-mjm6-r5xr, GHSA-2464-fhr4-w9xw, GHSA-vcvr-r3jv-pc5j, GHSA-2xp9-vwfh-vxw4, GHSA-p293-qw3h-jr36, plus several high/medium advisories).

- `create-ampless`: the scaffolded template now depends on `next@^16.4.6`, and `update-ampless` now manages `next` as a security floor. It raises only the version number to the template's minimum and preserves the site's operator (`16.2.6` -> `16.4.6`, `~16.2.6` -> `~16.4.6`, `^16.2.6` -> `^16.4.6`), updates it only in the section (`dependencies` / `devDependencies`) where the site already declares it, never downgrades a newer spec, and leaves unparseable specs (`latest`, `canary`, URLs, `workspace:`) and older majors (e.g. `^15.3.0`) untouched with a warning. **Existing sites must run `update-ampless` (or bump `next` themselves) and redeploy.**
- `@ampless/admin` / `@ampless/runtime`: only the dev dependency range changes. The `peerDependencies` range (`^15 || ^16`) is intentionally unchanged, since raising the peer floor would be a breaking change for consumers; consumers should still install `next >= 16.4.1` themselves.
