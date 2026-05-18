---
"create-ampless": patch
---

Two `--mount` / `--deploy` polish fixes surfaced while mounting an existing
project onto a renamed GitHub slug:

1. `--skip-confirm` now correctly suppresses the "Repository visibility"
   `select` prompt in `gatherDeployOptions`. Previously the prompt fired
   even with `--skip-confirm` because the guard only short-circuited when
   `--github-private` was explicitly passed.

2. `ghRepoExists` now uses `gh repo view --json nameWithOwner` and
   compares the resolved name to the requested slug. GitHub keeps a
   redirect from old → new repo names after a rename, so `gh repo view
   <old-name>` would succeed (false positive) and `--mount` would try to
   `git push` to the renamed repo instead of creating a fresh one at the
   originally-typed slug.
