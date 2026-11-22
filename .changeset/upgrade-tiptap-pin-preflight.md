---
"create-ampless": patch
---

`create-ampless upgrade` (`npm run update-ampless`) now checks the `@tiptap/*` packages a site added itself (ones the template does not ship, such as `@tiptap/extension-highlight`) before changing anything. Tiptap packages require the exact same `@tiptap/core` version, so an exact pin, `~` range or old major on such a package made `npm install` fail with ERESOLVE after the template files and `package.json` had already been rewritten.

If a range cannot share a version with the template's `@tiptap/core`, the upgrade now stops before writing any file and lists each entry along with the range to change it to. These packages are still never rewritten automatically. Caret ranges that overlap the template range keep working unchanged. Specs that cannot be checked (git URLs, `file:`, dist-tags) produce a warning. `--dry-run` prints the same report without stopping.
