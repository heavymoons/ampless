---
"ampless": patch
"create-ampless": patch
---

Pivot positioning to "customization-based CMS for engineers", aligning the
plugin author guide (en + ja, source-of-truth + template mirror) with the
new direction.

The plugin trust framework (`trust_level`, capabilities, IAM-scoped
trusted / untrusted Lambdas, `secretSettings`'s trusted-only hard gate) is
**implemented in v1 as first-party plugin organization** — which trust
tier's Lambda runs each event hook, which IAM permissions each tier
holds, narrowly-scoped hard gates such as the `settings.secret` →
`trust_level: 'trusted'` check. Most capability declarations are soft
warnings + admin labels + future allow-list surfaces. This is **not** a
marketplace-grade automatic sandbox for arbitrary third-party untrusted
plugins. Plugin authors are expected to write trusted code; the site
engineer audits each npm dep before installing (Astro integration /
Next.js plugin pattern). A real plugin marketplace + runtime sandbox is
a v2.0+ exploration item, not a v1 guarantee.

Repo-level documentation (README, CLAUDE.md, architecture roadmap +
plugin architecture + plugin distribution) is updated in the same PR
but does not need a changeset entry — those files do not ship in any
npm tarball.

No code change, no API change. Pure documentation reframing.
