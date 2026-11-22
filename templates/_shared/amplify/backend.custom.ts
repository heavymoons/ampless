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
// Example: opting a table out of DynamoDB point-in-time recovery.
// ampless enables PITR on every data table (including your custom
// models); this runs afterwards, so the override wins. See RUNBOOK.md
// for cost and restore details before turning it off.
//
//   export function customizeBackend(backend: AmplessBackend): void {
//     backend.data.resources.cfnResources.amplifyDynamoDbTables[
//       'KvStore'
//     ].pointInTimeRecoveryEnabled = false
//   }
//
// Example: opting PostHistory (or KvStore) in to DynamoDB TTL so rows
// whose `ttl` has passed are deleted. ampless leaves TTL off: turning it
// on deletes every already-expired row, irreversibly without PITR. Run
// the audit in RUNBOOK.md first. The setter is `timeToLiveAttribute` —
// assigning `timeToLiveSpecification` does nothing.
//
//   export function customizeBackend(backend: AmplessBackend): void {
//     backend.data.resources.cfnResources.amplifyDynamoDbTables[
//       'PostHistory'
//     ].timeToLiveAttribute = { attributeName: 'ttl', enabled: true }
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
