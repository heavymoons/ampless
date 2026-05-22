---
"@ampless/backend": patch
---

Fix `tsc --noEmit` failure on the template `amplify/data/resource.ts`
when downstream projects build with strict TypeScript settings (e.g.
Amplify Hosting's Next.js build worker).

`amplessSchemaAuthorization`'s return type was `unknown[]`, which
`.authorization((allow) => ...)` rejects: the schema builder wants
`SchemaAuthorization<any, any, any> | SchemaAuthorization<any, any, any>[]`,
and `unknown` doesn't narrow into that. The error surfaced as:

```
./amplify/data/resource.ts:47:29
Type error: Type 'unknown[]' is not assignable to type
'SchemaAuthorization<any, any, any> | SchemaAuthorization<any, any, any>[]'.
```

Widen the return type to `any[]`, matching the rest of this module's
intentional looseness around `@aws-amplify/data-schema`'s heavily
generic builder types. The schema itself still resolves through
`ClientSchema<typeof schema>` correctly downstream.
