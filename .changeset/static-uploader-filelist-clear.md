---
"@ampless/admin": patch
---

Fix two static-bundle picker bugs that surfaced as "no usable files found in the selection":

- The picker cleared the file input (`value = ''`) before reading the captured `FileList`. Because that list is live, it emptied to length 0, routing a single `.zip` down the loose-files branch and reporting an empty bundle. The selection is now snapshotted into a stable `File[]` before the input is cleared.
- Multi-file selection used `webkitRelativePath ?? f.name`, but `webkitRelativePath` is `''` (not `undefined`) for plain file selection, so every file got an empty path and was rejected as a "directory entry". Changed to `|| f.name` so loose files fall back to their filename.
