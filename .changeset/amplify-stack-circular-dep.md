---
"create-ampless": patch
---

Fix `CloudformationStackCircularDependencyError` during `ampx
pipeline-deploy` on the scaffolded template by assigning every Lambda
to its proper nested stack:

- `amplify/auth/post-confirmation/resource.ts` — was in the default
  `function` stack, making auth ↔ function a cycle (auth references
  the trigger arn; the Lambda references the user pool). Pin to
  `resourceGroupName: 'auth'`.
- `amplify/events/processor-untrusted/resource.ts` — was in the
  default `function` stack, making function ↔ data a cycle (function
  references the SQS queue and DDB table in data; data already
  references `processor-trusted` in the data stack). Pin to
  `resourceGroupName: 'data'` to match the dispatcher /
  processor-trusted siblings.
- `amplify/functions/user-admin/resource.ts` — comment updated to
  match the wording style already used in upgraded ampless
  installs (no behavior change; `resourceGroupName: 'data'` was
  already set).

After this patch the `function` nested stack is empty (every Lambda is
assigned to `auth` or `data`), and CloudFormation no longer cycles
between the four nested stacks.
