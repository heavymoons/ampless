---
"create-ampless": patch
---

Add `amplify/secrets/encryption-key.ts` to the default scaffolded `.gitignore`.

The plugin-secret AES key file was only gitignored when `setup-encryption-key --gitignore` was passed explicitly. Scaffolded projects now ignore it by default, so a generated key can't be accidentally committed (which would let anyone with repo access decrypt all stored plugin secrets).
