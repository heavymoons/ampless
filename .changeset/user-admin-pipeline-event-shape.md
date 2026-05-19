---
"@ampless/backend": patch
---

Fix `Cannot read properties of undefined (reading 'fieldName')`
TypeError thrown by the user-admin Lambda when the admin UI calls
`listAdminUsers` / `setAdminUserRole`.

Amplify Gen 2's `a.handler.function()` does NOT register the Lambda as
a canonical direct AppSync resolver — it generates a PIPELINE resolver
whose Lambda-invocation function emits a flat VTL payload:

    {
      "operation": "Invoke",
      "payload": {
        "typeName": "Query",
        "fieldName": "listAdminUsers",
        "arguments": { ... },
        "identity": ...,
        ...
      }
    }

The Lambda receives `event.fieldName` at the top level, NOT
`event.info.fieldName`. Typing the handler as `AppSyncResolverHandler`
was misleading and made `event.info` resolve to `undefined` at runtime.

Switch to a `Handler<UserAdminEvent>` typed against the actual flat
payload shape.
