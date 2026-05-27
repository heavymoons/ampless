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
   - Consumes the `.md` files (deletes them, records the names in `.changeset/pre.json` under `changesets: []`).
   - On merge, Release workflow re-runs and `changeset publish` ships the new versions to npm.

You as a feature-PR author only do step 1. **Don't touch step 2 or step 3 locally.**

## Pre-release (alpha) mode

This repo is currently in [changesets pre-release mode](https://github.com/changesets/changesets/blob/main/docs/prereleases.md), tagged `alpha`. The mode marker is `.changeset/pre.json` with `"mode": "pre"`.

Pre mode changes two things you need to know about:

1. **Consumed changeset names are remembered in `pre.json.changesets`.** This is so that exiting pre mode (`changeset pre exit`) can replay them into a final stable release entry. The names stay there even after the `.md` files are deleted.

2. **changesets/action treats names in `pre.json.changesets` as "already consumed".** Even if the corresponding `.md` file exists on disk, the action's pending-changeset detection excludes it. So a stale `pre.json.changesets` entry alongside the `.md` file → action says "No changesets found" → no Version Packages PR is opened.

## Pitfall: `pre.json` stale entry

**Symptom**: You merge a feature PR with a changeset. The Release workflow runs, says `No changesets found. Attempting to publish any unpublished packages to npm`, and **no Version Packages PR appears**.

**Cause**: `.changeset/pre.json`'s `changesets` array already contains the name of the changeset you just added. The Release workflow treats your `.md` as consumed and skips it.

**Why does it happen?** The most likely culprit is running `pnpm changeset version` (or `pnpm version-packages`) **locally during PR work**. That command processes any new `.md` in `.changeset/` and appends its name to `pre.json.changesets`. If you then commit `pre.json` along with your code changes and the `.md`, both the entry and the file land on main together — which is the broken state.

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

- `.changeset/*.md` (other than `pre.json` / `config.json` / `README.md`) = pending bumps not yet applied.
- `.changeset/pre.json.changesets` = bumps that have already been applied (in pre mode).
- A name should be in **exactly one** of those two places, never both, never neither (if you intended to bump that package).
- Feature-PR authors only ever add `.md` files. CI handles everything else.

## When in doubt

- `pnpm changeset status` — read-only, safe.
- `gh run list --workflow=release.yml --limit 5` — see what CI saw on each main push.
- `gh run view <id> --log-failed` — read the workflow log for a failed run.
- Avoid `pnpm changeset version` and friends locally.
