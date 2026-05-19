import type { AmplessBackend } from '@ampless/backend'

// Custom backend extensions for this project.
//
// `amplify/backend.ts` calls `customizeBackend(backend)` right after
// ampless's baseline wiring. Mutate the passed `backend` instance to
// add Lambda permissions, attach event sources, register custom CDK
// constructs, etc.
//
// This file is NEVER overwritten by `create-ampless upgrade` —
// `amplify/backend.ts` is, so keep your customizations here.
//
// (Function-export rather than side-effect import on purpose: a
// top-level `import { backend } from './backend.js'` would create an
// ESM circular dependency, leaving `backend` in its TDZ at evaluation
// time. The factory pattern sidesteps that.)
//
// Example: granting an existing ampless Lambda extra IAM permissions:
//
//   import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam'
//
//   export function customizeBackend(backend: AmplessBackend): void {
//     backend.processorTrusted.resources.lambda.addToRolePolicy(
//       new PolicyStatement({
//         effect: Effect.ALLOW,
//         actions: ['ses:SendEmail'],
//         resources: ['*'],
//       })
//     )
//   }
//
// Example: adding your own Lambda function — define it in
// `amplify/functions/<name>/resource.ts`, import it here, and attach
// it inside `customizeBackend` via `backend.createStack(...)` or by
// granting it permissions on existing resources.
//
// If you don't need any extensions, leave the body empty.

export function customizeBackend(_backend: AmplessBackend): void {
  // No-op by default.
}
