---
"create-ampless": patch
---

`create-ampless upgrade` (`npm run update-ampless`) now computes the final `package.json` and checks it before changing anything, so a dependency conflict no longer leaves a site half-upgraded with template files rewritten and `npm install` failing with ERESOLVE.

- `@tiptap/*` packages a site added itself (ones the template does not ship, such as `@tiptap/extension-highlight`) are checked against the peer dependencies their published releases declare on the npm registry. If no release the range allows is compatible with the ampless-managed versions, the upgrade stops before writing any file and lists each entry, the peer that conflicts (e.g. `requires @tiptap/core 3.32.0, template uses ^3.35.0`) and the range to change it to, or says that no compatible release exists yet. These packages are still never rewritten automatically. No lockstep versioning is assumed: packages such as `@tiptap/y-tiptap` that do not peer-depend on `@tiptap/core` pass with any pin. Specs that cannot be checked (git URLs, `file:`, dist-tags, unreachable registry) produce a warning. `--dry-run` prints the same report without stopping.
- In npm projects, the upgrade rehearses `npm install --package-lock-only` against the merged `package.json` in a temporary directory (with the site's `package-lock.json` and `.npmrc`) before writing anything, and stops if npm cannot resolve it. pnpm projects, `--no-install`, `--dry-run` and sites with `file:` / workspace dependencies skip the rehearsal.
- When `package.json` declares an ampless-managed package in a second section too (for example `optionalDependencies["@tiptap/core"]` next to the template's `dependencies` entry), that entry is now set to the same version, with a warning to remove the duplicate. Previously the stale duplicate survived and overrode the managed version.
- If `npm install` / `pnpm install` still fails after the files were written, the error now says so and points to `git status` / `git diff`.
