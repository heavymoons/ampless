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
     - Opens (or updates) a "Version Packages (alpha)" PR on the `changeset-release/main` branch.
   - If there are no pending changesets:
     - Runs `pnpm release` (= `changeset publish`) to publish anything on `main` that isn't yet on npm.

3. **Merge the Version Packages PR**
   - Bumps every affected package's `version` field.
   - Consumes the `.md` files (records the names in `.changeset/pre.json` under `changesets: []`). During pre-mode, the consumed `.md` files remain on disk alongside their `pre.json#changesets` entries — cleanup happens after `pre exit` or manually. The `pre.json#changesets` array is the source of truth for "consumed"; the presence or absence of the `.md` file is a secondary signal only.
   - On merge, Release workflow re-runs and `changeset publish` ships the new versions to npm.

You as a feature-PR author only do step 1. **Don't touch step 2 or step 3 locally.**

## Pre-release (alpha) mode

This repo is currently in [changesets pre-release mode](https://github.com/changesets/changesets/blob/main/docs/prereleases.md), tagged `alpha`. The mode marker is `.changeset/pre.json` with `"mode": "pre"`.

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

**Symptom**: A new `@ampless/plugin-<x>` package builds and publishes, but downstream sites scaffolded with `create-ampless` don't pick it up, or `npx create-ampless@latest upgrade` doesn't keep its version in sync, or the Release workflow crashes with the `CHANGELOG.md` ENOENT above.

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
- [ ] **At least one intentional beta changeset is queued for the first
      beta cut** (e.g. a `.changeset/*.md` that bumps one or more
      packages). `sync-dist-tag.mjs` includes a version-prerelease
      integrity guard: after the flip it re-asserts the `beta`
      dist-tag only on packages whose `package.json` version
      prerelease identifier matches `pre.json.tag` (i.e. has been
      bumped to `1.0.0-beta.<N>`). Packages still on `1.0.0-alpha.<N>`
      are skipped with a warn log, not mistakenly tagged. So a
      "partial beta cut" is safe — only the bumped packages move to
      `beta`, the rest stay on their existing `alpha` tag until they
      get bumped in a later cut. (Without the guard, the rule would
      tighten to "every public package must be bumped"; the guard is
      what lets this be a single-changeset operation.)
- [ ] No queued `.changeset/*.md` you don't intend to ship in the first
      beta cut (run `pnpm changeset status` to inspect)
- [ ] No open "Version Packages (alpha)" PR — merge or close it first
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

### Two open questions to resolve at flip time (NOT in this Prep PR)

#### A. exit/enter sequencing — avoid stray `1.0.0` publish

The naive sequence is `pre exit && pre enter beta`. Beware: if anything
runs `pnpm changeset version` between those two commands (for example,
the `changesets/action` GitHub Action firing on a `main` push), it will
strip the pre-suffix in-flight and produce a real `1.0.0` release
PR. We do **not** want that intermediate `1.0.0` publish to land on
npm.

Candidate shapes (each needs validation in a fork before the real flip):

1. **Atomic operational workflow** (sketch): add a one-shot
   `workflow_dispatch` workflow that runs all of the following in a
   single job, so `changesets/action` can't fire a stray `version`
   mid-sequence. **Use the existing `package.json` script aliases**
   (`version-packages` / `release`) rather than direct
   `changeset version` / `changeset publish` calls — the existing
   aliases wrap `scripts/sync-template-versions.mjs` and `turbo run
   build` respectively, and bypassing them would publish without the
   template-version-sync and the pre-publish build:
   1. `pnpm changeset pre exit` (modifies `.changeset/pre.json`)
   2. `pnpm changeset pre enter beta` (modifies `.changeset/pre.json`)
   3. **`pnpm version-packages`** — the existing alias is
      `changeset version && node scripts/sync-template-versions.mjs &&
      changeset version` ([package.json:14](../package.json#L14));
      runs `version` once to bump packages from changesets, runs the
      template-version sync to update `templates/_shared/package.json`
      pinned versions, then runs `version` again to absorb any
      auto-sync changeset the previous step emitted. Using this alias
      preserves the existing template-pin invariant.
   4. **`git add -A && git commit -m "<message matching the chosen release.yml guard>" && git push origin HEAD:main`**
      (GitHub Actions checkout typically leaves a detached HEAD; the
      explicit `HEAD:main` refspec disambiguates the push target)
      (e.g. `"chore: flip alpha → beta [skip ci]"` if the chosen
      suppression is `[skip ci]` in the commit message; or
      `"chore: flip alpha → beta"` if the chosen suppression is an
      `if:` guard on `release.yml`'s `head_commit.message` matching the
      same phrase). Without this commit/push step, the workflow leaves
      npm ahead of the repo state (= the next normal `changesets/action`
      run sees stale local state and either re-opens a stale VP PR or
      silently double-bumps). Use a deploy key / PAT with
      `contents: write` permission. The commit-message phrase and the
      `release.yml` guard **must be authored as one consistent pair**
      to actually suppress the double-trigger.
   5. **`pnpm release`** — the existing alias is `turbo run build &&
      changeset publish` ([package.json:16](../package.json#L16));
      runs the full workspace build (necessary because `changeset
      publish` only publishes the existing built artifacts, it does
      not build), then publishes the beta-version tarballs to npm.
      **Note**: in pre mode, "only-pre packages" — those that have
      not yet had a non-pre release — get `npm publish --tag latest`
      by default rather than the pre-mode tag (`alpha` / `beta`).
      This is exactly why `sync-dist-tag.mjs` exists: to re-assert
      the correct pre-mode tag after publish. Step 6 below handles
      this.
   6. `node scripts/sync-dist-tag.mjs` re-asserts the `beta` dist-tag
      across **matching public workspace packages** (the renamed script
      reads `pre.json.tag`, which is now `"beta"`, and skips packages
      whose `package.json` version prerelease identifier does not match
      — so a still-on-alpha package would be skipped with a warn log,
      not mistakenly tagged).
   7. **Push the git tags that `pnpm changeset publish` created**.
      Changesets' CLI creates one `<pkg-name>@<version>` tag per
      published package locally (using the full npm name including
      scope — e.g. `ampless@1.0.0-beta.<N>`,
      `@ampless/runtime@1.0.0-beta.<N>`, `create-ampless@1.0.0-beta.<N>`)
      but **does NOT push them to the remote**. Without this step,
      GitHub Releases stay missing for the beta cut, and any
      downstream tooling that watches `git tag` events (e.g.
      release-notes generators) sees nothing. Use one of:
      - `git push origin --follow-tags HEAD:main` (single command,
        pushes the branch and reachable annotated tags at the same
        time; matches the detached-HEAD shape from step 4)
      - or push per-tag explicitly:
        `git push origin <pkg-name>@<version>` for each created tag.
      If you do not want per-package tags at all, you need to pass
      `--no-git-tag` to `changeset publish` directly. The `pnpm release`
      alias used in step 5 (= `turbo run build && changeset publish`,
      [package.json:16](../package.json#L16)) does **not** forward extra
      arguments to `changeset publish` (pnpm-script alias arg-forwarding
      is fiddly and not used here), so the precise replacement command is:

      ```sh
      pnpm build && pnpm changeset publish --no-git-tag
      ```

      (= run `pnpm release` but with the publish step replaced by the
      no-tag variant.) Document the choice in the flip PR if taken.
      The default behaviour is to create the tags, so steps 7's push is
      needed unless the no-tag variant is explicit.

   Suppressing double-trigger of the normal `release.yml`: either
   include `[skip ci]` in the commit message, or guard `release.yml`
   with `if: !contains(github.event.head_commit.message, 'flip alpha → beta')`,
   or temporarily disable `release.yml` for the duration of the manual
   dispatch (less elegant). The Prep PR does not pick one; the flip PR
   will.
2. **Direct `pre.json` edit**: change `pre.json.tag` from `"alpha"` to
   `"beta"` in a 1-line PR. Stays inside pre-mode the whole time
   (avoiding the exit/enter pitfall entirely). Changesets does not
   officially document this technique; works in practice because the
   counter logic only looks at `tag`, but it's unofficial.

#### B. The pre-counter is not reset by `pre enter beta`

Both shapes above inherit the alpha pre-counter. If today's `ampless`
`@alpha` is at `1.0.0-alpha.N`, after a beta cut without counter reset,
the first beta publish would be roughly `1.0.0-beta.N+1` (next integer
in the same counter), **not** `1.0.0-beta.0`. Different packages have
different counters (`create-ampless` runs notably higher than `ampless`
because of template auto-sync); each one continues independently from
its own latest alpha `N`.

This is technically semver-valid: pre-release identifiers compare
lexicographically per dotted segment, and the integer continuity is a
pure cosmetic concern — the same package never publishes the same
`-beta.N` twice. But CHANGELOG.md will skip from the last
`alpha.<some-N>` straight to `beta.<N+1>`, which may confuse readers.

Options (decide at flip time):

- **Accept the continuity** (recommended unless cosmetics matter):
  publish `1.0.0-beta.<N+1>` (where `N` is the package's latest alpha
  counter), document the jump in CHANGELOG; release
  notes can spell out the alpha → beta transition explicitly.
- **Reset the counter to 0**: requires custom tooling (edit
  `pre.json.changesets` array to drop the alpha entries, or hand-bump
  every package's `version` in `package.json` from `1.0.0-alpha.N`
  to `1.0.0-beta.0` before `pre enter beta` runs). Both are
  manual + error-prone. Worth doing only if the cosmetics strongly
  matter.

The Prep PR (this one) does not commit to either A or B; refine both
when the flip PR is authored, ideally after testing in a throwaway
fork.

### What also changes at the flip

- `.github/workflows/release.yml`: uncomment `NPM_CONFIG_PROVENANCE`
  (provenance requires a public repo)
- Repo visibility: GitHub Settings → flip to Public (after Settings →
  Security → Private vulnerability reporting → Enable)
- `README.md` + `.ja.md`: install commands using `@alpha` may stay or
  flip to `@beta` (engineer's call — `@alpha` last-published tarball
  remains pinned by `sync-dist-tag.mjs` after `pre exit`)
- `CLAUDE.md`: `## Status` section may want a 1-line update reflecting
  current stage (alpha → beta)
- `docs/architecture/14-roadmap.md`: no change required (the four-stage
  path framing is stage-agnostic)
- `.changeset/pre.json#tag`: `"alpha"` → `"beta"`. **The exact mechanism
  depends on the chosen flip shape from §A above**: for the atomic
  workflow shape, this happens implicitly via `pre exit && pre enter
  beta` inside the same workflow run; for the direct-edit shape, this
  is a 1-line PR that just edits `pre.json#tag` (no `pre exit` / `pre
  enter` involved). Either way the edit pairs with the rest of the flip
  — it is NOT a free-standing change.

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
