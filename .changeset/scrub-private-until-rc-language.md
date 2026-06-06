---
"ampless": patch
"create-ampless": patch
---

Scrub old "private until v1.0 RC" framing from documentation that ships
in the ampless tarball and the create-ampless scaffold.

The ampless release plan changed (2026-05-26) from the old two-stage
(closed → public at v1.0 RC) plan to a four-stage path:
**alpha → beta → RC → stable**. Today's stage is alpha (private repo,
npm `alpha` dist-tag); beta is the public-flip moment (repo public,
npm `beta` dist-tag, breaking changes still possible); RC is the
feature-complete / no-more-breaking-changes phase; stable ships with
the ampless introduction page (built with ampless) simultaneously.

This patch rewrites the §15 "Where to ask questions" closing paragraph
in the plugin author guide (en + ja, source-of-truth and template
mirror — 4 files synced) to describe the beta moment as the public-
flip, not v1.0 RC. The previous wording implied that GitHub links
would not resolve until v1.0 RC, which is no longer accurate.

No code change, no API change. Pure doc fix.

The matching top-level documentation (`README.md` + .ja.md,
`CLAUDE.md` + .ja.md, `docs/architecture/14-roadmap.md` + .ja.md) is
updated in the same PR but does not need a changeset entry —
repo-level docs do not ship in any npm tarball.
