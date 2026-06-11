# Release workflow operations

> 日本語版: [release-workflow.ja.md](./release-workflow.ja.md)

This document covers how the changesets-driven release pipeline works in this repo and the operational rules that keep it functioning. CI handles the entire mechanism — your job as a feature-PR author is mostly to **add a changeset and stop there**.

If you only read one thing in this document, read [Pitfall: pre.json stale entry](#pitfall-prejson-stale-entry).

## Pipeline overview

1. **Author a feature PR**
   - Make code changes.
   - Add `.changeset/<slug>.md` with the version bump frontmatter (see [CLAUDE.md → Changeset Policy](../CLAUDE.md#changeset-policy)).
   - Commit, push, open PR, get review, merge to `main`.

2. **Release workflow (`.github/workflows/release.yml`) runs on push to `main`**
   - Uses [`changesets/action@v1`](https://github.com/changesets/action).
   - If there are pending changesets in `.changeset/`:
     - Runs `pnpm version-packages` (= `changeset version`).
     - Opens (or updates) a "Version Packages (<pre-tag>)" PR on the `changeset-release/main` branch.
   - If there are no pending changesets:
     - Runs `pnpm release` (= `changeset publish`) to publish anything on `main` that isn't yet on npm.

3. **Merge the Version Packages PR**
   - Bumps every affected package's `version` field.
   - Consumes the `.md` files (records the names in `.changeset/pre.json` under `changesets: []`). During pre-mode, the consumed `.md` files remain on disk alongside their `pre.json#changesets` entries — cleanup happens after `pre exit` or manually. The `pre.json#changesets` array is the source of truth for "consumed"; the presence or absence of the `.md` file is a secondary signal only.
   - On merge, Release workflow re-runs and `changeset publish` ships the new versions to npm.

You as a feature-PR author only do step 1. **Don't touch step 2 or step 3 locally.**

## Pre-release mode

This repo uses [changesets pre-release mode](https://github.com/changesets/changesets/blob/main/docs/prereleases.md). The active pre-release tag is `.changeset/pre.json#tag`: `alpha` before the public beta flip, `beta` after it. The mode marker is `.changeset/pre.json` with `"mode": "pre"`.

Pre mode changes two things you need to know about:

1. **Consumed changeset names are remembered in `pre.json.changesets`.** This is so that exiting pre mode (`changeset pre exit`) can replay them into a final stable release entry. The names stay there even after the `.md` files are deleted. In fact, during pre-mode the consumed `.md` files typically remain on disk alongside their `pre.json#changesets` entries — that is the normal "consumed" state. Cleanup (deleting the `.md` files) happens after `pre exit` or manually; `pre.json#changesets` is the authoritative source of truth.

2. **changesets/action treats names in `pre.json.changesets` as "already consumed".** Even if the corresponding `.md` file exists on disk, the action's pending-changeset detection excludes it. So a stale `pre.json.changesets` entry alongside the `.md` file → action says "No changesets found" → no Version Packages PR is opened.

## Pitfall: `pre.json` stale entry

**Symptom**: You merge a feature PR with a changeset. The Release workflow runs, says `No changesets found. Attempting to publish any unpublished packages to npm`, and **no Version Packages PR appears**.

**Cause**: `.changeset/pre.json`'s `changesets` array already contains the name of the changeset you just added. The Release workflow treats your `.md` as consumed and skips it.

**Why does it happen?** The most likely culprit is running `pnpm changeset version` (or `pnpm version-packages`) **locally during PR work**. That command processes any new `.md` in `.changeset/` and appends its name to `pre.json.changesets`. If you then commit `pre.json` along with your code changes and the `.md`, both the entry and the file land on main together — which is the broken state.

**Note**: this pitfall is distinct from the legitimate ✗/✓ state (`.md` absent, `pre.json#changesets` entry present) that results from manually cleaning up consumed `.md` files. That cleanup is deliberate and harmless — see the Mental model section below. The pitfall described here is about a `.md` that has *not yet been consumed* (no corresponding version bump published) getting a spurious `pre.json#changesets` entry that causes the action to skip it.

A second possible cause: running tools or scripts (or an AI agent) that invoke `changeset version` as a side effect.

### Don't do this

```bash
# DON'T run these during feature-PR work
pnpm changeset version
pnpm version-packages
pnpm release
pnpm changeset pre exit
pnpm changeset pre enter
```

These are CI's job (via changesets/action). Running them locally during a feature PR rewrites `pre.json` and the changeset `.md` files into a state the pipeline won't recover from.

### Do this instead

```bash
# Add a changeset interactively
pnpm changeset

# Or hand-write a .md file
echo '---
"@ampless/admin": minor
---

Short description.' > .changeset/my-change.md

# Verify what will happen (read-only)
pnpm changeset status
```

`changeset status` is safe — it only reads. It tells you what bumps would happen *if* you ran `version` right now.

### Recovery (if you already merged a stale state)

This has happened before — see [#135](https://github.com/heavymoons/ampless/pull/135) and [#139](https://github.com/heavymoons/ampless/pull/139). Both followed the same fix.

1. Confirm the symptom in the Release workflow log: `No changesets found`.
2. Confirm both states exist on `main`:
   - `.changeset/<your-slug>.md` exists.
   - `.changeset/pre.json`'s `changesets` array contains `"<your-slug>"`.
3. Open a tiny fix PR that **removes the entry from `pre.json` only**. Leave the `.md` alone.
4. Verify locally with `pnpm changeset status` — your bumps should appear in the "Packages to be bumped" output.
5. Merge. The next Release workflow run picks the changeset up and opens the Version Packages PR.

## Pitfall: missing `CHANGELOG.md` in a new package

**Symptom**: Release workflow crashes with `Error: ENOENT: no such file or directory, open '.../packages/<pkg>/CHANGELOG.md'` during the Version Packages PR body generation step.

**Cause**: `changesets/action` reads every released package's `CHANGELOG.md` to compose the PR body. New packages need one even when there are no prior entries.

**Prevention**: When adding a new package under `packages/`, create `packages/<pkg>/CHANGELOG.md` with at minimum:

```markdown
# @ampless/<pkg>
```

Verified in [#136](https://github.com/heavymoons/ampless/pull/136). Worth grepping for at PR-review time when a new `packages/<pkg>/` folder appears.

## Pitfall: incomplete wiring when adding a new plugin package

**Symptom**: A new `@ampless/plugin-<x>` package builds and publishes, but downstream sites scaffolded with `create-ampless` don't pick it up, or `npx create-ampless@beta upgrade` doesn't keep its version in sync, or the Release workflow crashes with the `CHANGELOG.md` ENOENT above.

**Cause**: Adding a plugin touches six places. Missing any one of them leaves the plugin "almost shipped" — the npm tarball exists but the rest of the pipeline acts like it's not there. This list comes from real fixes:

- `#136` ([heavymoons/ampless#136](https://github.com/heavymoons/ampless/pull/136)) — first GA4 publish crashed because `CHANGELOG.md` was missing.
- `#142` ([heavymoons/ampless#142](https://github.com/heavymoons/ampless/pull/142)) — GA4 wasn't in the template `package.json`, so scaffolded sites never installed it.

**Checklist** when adding `packages/<plugin>/`:

1. **`packages/<plugin>/CHANGELOG.md`** — create with minimum `# @ampless/<plugin>` content. **Do not** add it to `files` in `package.json`; the npm tarball should not include it (existing plugins follow this convention).
2. **`packages/create-ampless/src/upgrade.ts`** — add the package name to the `AMPLESS_PACKAGES` set so `create-ampless upgrade` keeps the version in sync with subsequent ampless releases.
3. **`templates/_shared/package.json`** — add the plugin to `dependencies` (use a placeholder `^0.1.0-alpha.0` range; `scripts/sync-template-versions.mjs` will rewrite it to the real version after the first publish).
4. **`templates/_shared/cms.config.ts`** — add a commented-out registration example next to the existing opt-in plugins (skip this step only if the plugin is mandatory and should ship registered).
5. **`docs/architecture/09-plugin-distribution.md`** + `.ja.md` — add the plugin to the first-party list with its `trust_level` and a one-line description.
6. **`packages/ampless/docs/plugin-author-guide.md`** + `.ja.md` — add the plugin to the "worked examples" link list in §12. Then copy both files into `templates/_shared/docs/` so the scaffold copy stays byte-for-byte in sync (there's no CI check for this yet).

If you forget #1, the Release workflow crashes loudly; #2–#6 fail silently and only surface when a downstream user is confused about why the plugin isn't installable / discoverable. Grep for `@ampless/plugin-` in the diff at PR-review time when a new `packages/plugin-*/` folder appears.

## Pitfall: forgetting the changeset entirely

**Symptom**: PR merges, Release workflow runs, no version bump happens, and a downstream consumer's `npm install` doesn't get your fix.

**Cause**: No `.md` file in `.changeset/`. Doc-only or no-publish changes don't need one; published-package code or README changes do.

**Prevention**: See [CLAUDE.md → Changeset Policy](../CLAUDE.md#changeset-policy) for the scoping rules. When reviewing a PR that touches `packages/<pkg>/`, scan for `.changeset/*.md` in the diff.

## Mental model

The four states a changeset name can be in during pre-mode:

| `.md` exists | `pre.json#changesets` entry | Meaning |
|---|---|---|
| ✓ | ✗ | **queued** — not yet consumed; will be picked up in the next Version Packages cycle |
| ✓ | ✓ | **consumed** — the natural pre-mode state; `.md` stays on disk alongside the `pre.json` entry until cleanup |
| ✗ | ✓ | **consumed-and-cleaned-up** — legitimate post-curation state; `.md` was manually deleted after consumption |
| ✗ | ✗ | **unknown** — name is not tracked anywhere; likely indicates a typo or a removed-before-consumed entry |

The `pre.json#changesets` array is the authoritative source of truth for consumed status. Feature-PR authors only ever create `.md` files (adding to the "queued" state). CI handles everything else — consuming, bumping, and publishing.

## Flipping from alpha to beta pre-release

The alpha → beta transition is when ampless flips the npm dist-tag from
`alpha` to `beta`, makes the GitHub repo public, and starts accepting
external installs (see [release strategy](./architecture/14-roadmap.md)).
This is a **single, irreversible operational moment**. Plan it carefully.

### Pre-flight checklist

Before initiating the flip, confirm all of:

- [ ] Public-flip docs are merged (README scrub, Community files,
      Positioning pivot — see git log around PR #240, #242, #243, #244)
- [ ] Public-flip package changes may carry normal changesets (for
      example docs / CLI behavior that must publish as `beta`). After
      that prep PR lands on `main`, the normal Release workflow may open
      a "Version Packages (alpha)" PR. **Close it unmerged** before the
      flip; the queued changesets remain on `main` and the flip workflow
      consumes them under the `beta` tag.
      Do **not** pre-stage a separate "first beta" changeset: the flip
      workflow auto-generates a kickoff changeset
      (`.changeset/beta-kickoff-<tag>.md`, `ampless: patch`, "First
      beta cut") immediately before running `pnpm version-packages`.
      `sync-dist-tag.mjs` includes a version-prerelease integrity guard:
      after the flip it re-asserts the `beta` dist-tag only on packages
      whose `package.json` version prerelease identifier matches
      `pre.json.tag` (i.e. has been bumped to `1.0.0-beta.<N>`).
      Packages still on `1.0.0-alpha.<N>` are skipped with a warn log,
      not mistakenly tagged. So a "partial beta cut" is safe — only the
      bumped packages move to `beta`, the rest stay on their existing
      `alpha` tag until they get bumped in a later cut.
- [ ] No queued `.changeset/*.md` you don't intend to ship in the first
      beta cut (run `pnpm changeset status` to inspect)
- [ ] No open "Version Packages (alpha)" PR — close the public-flip
      one unmerged; resolve unrelated alpha VP PRs intentionally first
- [ ] GitHub security baseline is enabled: Dependabot alerts and
      Dependabot security updates are on; Actions default token
      permissions are read-only
- [ ] Dogfood site (e.g. ishinao.net) is healthy on the latest published
      `@alpha`; the rollback path back to a known-good `@alpha` tarball
      is mentally walked
- [ ] You (the maintainer) have the ~30 min uninterrupted to do the
      flip + monitor the publish workflow

### Why this is a CI-only operation

`pnpm changeset pre exit` and `pnpm changeset pre enter beta` rewrite
`.changeset/pre.json`. Running these locally during a feature PR (or any
non-coordinated context) silently drops bumps — see
[Pitfall: pre.json stale entry](#pitfall-prejson-stale-entry) above and
CLAUDE.md `## Changeset Policy` for the historical incidents (#135, #139).

The flip therefore runs as a coordinated operation on `main`, not as a
local edit on a feature branch.

### Resolved decisions (formerly "Two open questions")

These were open in the Prep PR. Both are now decided and implemented in
`.github/workflows/flip-prerelease.yml`.

#### A. exit/enter sequencing — decision: atomic workflow + [skip ci]

**Chosen approach**: `.github/workflows/flip-prerelease.yml` — a single
`workflow_dispatch` job that runs all of the following in one atomic
sequence, so `changesets/action` can never fire a stray `version` run
between the `pre exit` and `pre enter` steps:

1. `pnpm changeset pre exit`
2. `pnpm changeset pre enter <tag>`
3. Auto-generate kickoff changeset (`beta-kickoff-<tag>.md`)
4. `pnpm version-packages` (alias — includes template-version-sync)
5. `git commit -m "chore: flip prerelease to <tag> [skip ci]" && git push origin HEAD:main`
6. `pnpm release` (alias — includes pre-publish build)
7. 3-stage package tag reconcile + explicit push (per-name, not `--tags`)
8. `.npmrc` rewrite + `node scripts/sync-dist-tag.mjs`

**Double re-trigger suppression** (two independent layers):

- Primary: GITHUB_TOKEN push does not trigger push-based workflows
  by GitHub platform design, so `release.yml` is not fired by the flip
  commit. `release.yml` is **not modified** — no `if:` guard needed.
- Belt-and-suspenders: `[skip ci]` in the commit message.

#### B. pre-counter — decision: accept continuity

The alpha pre-counter is **not reset** when entering beta. The first
beta cut starts at `1.0.0-beta.<N+1>` (where `N` is each package's
latest alpha counter). This is semver-valid; the CHANGELOG skip from
`alpha.<N>` to `beta.<N+1>` may look cosmetically odd but is accurate.
No custom reset tooling is introduced. The alpha → beta transition is
called out explicitly in the release notes.

### Executing the flip

The flip is a two-phase dispatch: first a dry-run to review what will
happen, then the real flip.

**Phase 1 — dry-run**

Dispatch `.github/workflows/flip-prerelease.yml` from **main** (not any
feature branch) with:

```
tag:     beta
mode:    dry-run
confirm: (leave blank)
```

When the run completes, download the `flip-preview` artifact. Review:

- `version-diff.patch`: `pre.json` should show `{mode: "pre", tag: "beta"}`;
  packages bumped by the kickoff changeset and any queued alpha
  changesets should move from `1.0.0-alpha.N` to `1.0.0-beta.N+1`;
  `templates/_shared/package.json` pinned versions should be updated.
- **`CHANGELOG.md` diffs must contain ONLY the new entries** (the kickoff
  changeset + any genuinely-pending changesets). If the diff re-lists
  alpha-era changes that already shipped (= the `pre exit` / `pre enter`
  cycle dropped the consumed-changesets bookkeeping and `version`
  re-applied the accumulated alpha `.md` files), STOP — do not run the
  live flip. That failure mode would duplicate every alpha entry in
  every CHANGELOG and over-bump packages; it must be resolved (e.g. by
  also deleting the already-consumed alpha `.md` files in the same
  workflow step, validated by another dry-run) before proceeding.
- `status.txt`: all changed files are accounted for.
- Packages still on alpha (no pending changesets) stay on their
  alpha version — this is correct; `sync-dist-tag.mjs` skips them.

**Phase 2 — live flip**

Once the dry-run diff looks correct, dispatch again with:

```
tag:     beta
mode:    flip
confirm: flip-to-beta
```

The workflow commits the version bump to main, publishes to npm, pushes
package tags, and syncs the `beta` dist-tag.

**Post-flip verification**

```sh
npm view ampless@beta version        # should show 1.0.0-beta.<N>
npm view ampless@alpha version       # frozen at last alpha; no longer moving
npm view ampless@latest version      # may point to same as beta (only-pre packages)
gh run list --workflow=release.yml   # next normal push should trigger release.yml cleanly
```

**npm provenance** is **not** enabled by this workflow. Provenance
requires a public GitHub source repository. Making the repo public is a
manual step in GitHub Settings that happens separately (outside this
workflow). After the repo goes public, enable provenance by
un-commenting `NPM_CONFIG_PROVENANCE: true` in `.github/workflows/release.yml`
in a follow-up PR.

### Recovering a partial flip

If the flip commit was pushed to main successfully (steps 1–5 of the
workflow above completed) but the publish, tag push, or dist-tag sync
failed, the repo is now in beta mode (`pre.json.tag == "beta"`) but npm
is not yet updated. Re-dispatching with `mode=flip` would fail the
pre-flight check ("pre.json.tag is already 'beta'").

Use `mode=publish-only` to recover:

```
tag:     beta
mode:    publish-only
confirm: flip-to-beta
```

`publish-only` skips `pre exit` / `pre enter` / kickoff / version /
commit. It goes directly to `pnpm release` → tag reconcile → dist-tag
sync. All three steps are idempotent:

- `changeset publish` skips versions already on npm.
- Tag reconcile skips tags already on the remote.
- `sync-dist-tag.mjs` is a no-op if the dist-tag already points at the
  correct version.

The `publish-only` pre-flight asserts `pre.json.tag == requested tag`
(the inverse of the flip check), confirming this is the recovery
scenario and not an accidental double-flip.

### What also changes at the flip

- `.changeset/pre.json#tag`: `"alpha"` → `"beta"`. Handled atomically
  inside the `flip-prerelease.yml` workflow via `pre exit && pre enter
  beta`. It is **not** a separate commit or PR.
- Repo visibility: GitHub Settings → flip to Public after the live beta
  publish succeeds. This is a manual step outside the workflow. After
  the repo is public, immediately enable Private Vulnerability Reporting
  (Settings → Security → Private vulnerability reporting, or
  `gh api -X PUT repos/heavymoons/ampless/private-vulnerability-reporting`)
  and confirm secret scanning / push protection if GitHub exposes them
  for the repo.
- `.github/workflows/release.yml`: **un-comment `NPM_CONFIG_PROVENANCE`
  after repo goes public** (provenance requires a public repo; this is
  a post-public TODO in a follow-up PR, not part of the flip workflow).
- `README.md` + `.ja.md`, `CLAUDE.md`, and
  `docs/architecture/14-roadmap.md`: should already describe the public
  beta stage before the repo visibility flip.

### What does NOT change at the flip

- `scripts/sync-dist-tag.mjs`: reads `pre.json.tag` so it auto-detects
  the new tag once `pre.json.tag` flips
- `scripts/sync-template-versions.mjs`: unchanged
- `.changeset/config.json`: `access: "public"` already

### Rollback story

If the beta cut publishes something broken, the existing alpha tarballs
remain installable via `npm i ampless@1.0.0-alpha.<some-N>` (any of the
already-published alpha versions). Rolling the dist-tag back to a
known-good alpha is `npm dist-tag add
ampless@1.0.0-alpha.<known-good-version> alpha`. No data loss; npm
publishes are immutable. Find the last known-healthy version by checking
`npm view ampless versions --json | tail -20` and cross-referencing the
production dogfood deploy logs.

## When in doubt

- `pnpm changeset status` — read-only, safe.
- `gh run list --workflow=release.yml --limit 5` — see what CI saw on each main push.
- `gh run view <id> --log-failed` — read the workflow log for a failed run.
- Avoid `pnpm changeset version` and friends locally.
