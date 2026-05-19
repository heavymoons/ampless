// Custom data schema models for this project.
//
// `amplify/data/resource.ts` calls `customSchemaModels(a)` and spreads
// the result alongside ampless's built-in models in the same
// `a.schema({...})` call, which is the only way Amplify Gen 2's
// `ClientSchema<typeof schema>` inference picks up extra models.
//
// This file is NEVER overwritten by `create-ampless upgrade` —
// `amplify/data/resource.ts` is, so keep your custom models here.
//
// Example:
//
//   export function customSchemaModels(a: any) {
//     return {
//       Bookmark: a
//         .model({
//           siteId: a.string().required(),
//           bookmarkId: a.id().required(),
//           url: a.string().required(),
//           title: a.string(),
//         })
//         .identifier(['siteId', 'bookmarkId'])
//         .authorization((allow: any) => [allow.groups(['ampless-admin', 'ampless-editor'])]),
//     }
//   }
//
// `a` is the Amplify Gen 2 schema builder; see Amplify Data docs for
// the full DSL. Return an empty object if no customizations are needed.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function customSchemaModels(_a: any): Record<string, unknown> {
  return {}
}
