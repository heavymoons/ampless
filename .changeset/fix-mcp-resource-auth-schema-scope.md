---
"@ampless/backend": minor
"create-ampless": patch
---

Fix `[TypeError] allow.resource is not a function` during CDK deploy of
the v0.2 Phase 4 MCP HTTP transport.

Root cause: model-level `.authorization((allow) => [...])` callbacks in
`@aws-amplify/data-schema` destructure `resource` out of their `allow`
parameter before invoking the callback (`ModelType.js`: `const { resource: _, ...rest } = Authorization_1.allow`).
The `.d.ts` files still surface `.resource` on the model-level `allow`
type, which misled Phase 4 into believing it could grant the MCP Lambda
access per-model. At runtime the property is missing and CDK Assembly
fails. The TODO comment in `Authorization.js` confirms it:
"delete when we make resource auth available at each level in the schema
(model, field)" — currently it's schema-scope only.

Fix: move the resource grant from each model's authorization clause to
schema scope. `amplessSchemaModels` no longer accepts
`mcpHandlerFunction`; a new exported helper does:

```typescript
import {
  amplessSchemaModels,
  amplessSchemaAuthorization,
} from '@ampless/backend'

const schema = a
  .schema({
    ...amplessSchemaModels(a, { resolverPaths, userAdminFunction: userAdmin }),
    ...customSchemaModels(a),
  })
  .authorization((allow) => amplessSchemaAuthorization(allow, {
    mcpHandlerFunction: mcpHandler,
  }))
```

The template `amplify/data/resource.ts` is updated accordingly so
`update-ampless` carries the fix to existing projects. Schema-scope
resource auth is wider than model-scope would have been (the grant
applies to every model in the schema instead of only Post / PostTag /
Media), but it's the only level the upstream library honours; the MCP
tools' GraphQL operations narrow the effective surface anyway.
