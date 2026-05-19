---
'create-ampless': patch
---

Add `.custom.ts` extension points (`amplify/backend.custom.ts`,
`amplify/data/resource.custom.ts`) for user customizations. These
files are never overwritten by `create-ampless upgrade`, so ampless
can safely refresh `backend.ts` / `data/resource.ts` while preserving
project-specific extensions.
