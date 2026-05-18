---
"create-ampless": minor
---

Add `--mount` mode: publish an existing ampless project (in the current
directory) onto a new GitHub repo + Amplify Hosting app + custom domain,
without re-running scaffold.

Usage (after scaffolding and testing locally with `npx ampx sandbox`):

```sh
cd my-existing-ampless-project
npx create-ampless@alpha --mount \
  --github-owner <login> \
  --aws-profile <profile> \
  --aws-region <region> \
  --domain example.com \
  --create-iam-role \
  --skip-confirm
```

Behavior:

- Validates that the cwd looks like an ampless project (`package.json`,
  `cms.config.ts`, and an `amplify/` directory) before any side effects.
- Skips scaffolding entirely. `--site-name`, `--themes`, `--plugins`, and
  the positional `<project-name>` are ignored (with a warning).
- `git init`/commit step is idempotent: re-uses an existing git repo,
  commits any pending changes, and warns if the current branch isn't
  `main` (Amplify Hosting wires up `main`).
- `gh repo create` step is idempotent: if the target
  `<owner>/<basename(cwd)>` repo already exists, sets up `origin` (if
  unset) and pushes the current commit to `main` instead of trying to
  re-create.
- Drops a sensible default `.gitignore` if the project doesn't have one,
  so `amplify_outputs.json`, `node_modules`, and `.next` aren't
  accidentally committed.
- Pre-flight's "GitHub repo must not exist" check is relaxed in mount
  mode.

`--mount` implies `--deploy` — the rest of the deploy flow (Amplify
Hosting app, main branch, first build, custom domain) is shared with the
existing `--deploy` mode.
