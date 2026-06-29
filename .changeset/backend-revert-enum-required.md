---
"@ampless/backend": patch
---

Revert the `.required()` additions on enum fields from the previous release — they break `ampx pipeline-deploy` at CDK synth time with `a.enum(...).required is not a function`.

Amplify Gen 2 enum fields (`a.enum(...)`) are always nullable and do not expose a `.required()` modifier at runtime (only the TypeScript types loosely permit it). `Post.format` / `Post.status`, `Page.format` / `Page.status` are restored to plain nullable enums, and `Media.delivery` is restored to a nullable `a.string()`. The application layer still always populates these fields; the `Post` / `Page` TypeScript interfaces continue to treat them as non-optional, but the GraphQL schema cannot enforce `required` on enum fields.
