---
'@ampless/backend': patch
---

Bump the `aws-cdk-lib` devDependency from `^2.257.0` to `^2.278.0`
(supersedes Dependabot #356, which targeted 2.260.0). No source
changes. The `aws-cdk-lib: ^2` peer range is unchanged, so a site keeps
using whatever `aws-cdk-lib` its own project installs.

For reference, synthesizing the scaffolded `templates/_shared` Amplify
backend with 2.278.0 instead of 2.257.0 yields the same resource set.
Only CDK-managed helper resources change: the
`Custom::S3AutoDeleteObjects` provider Lambda moves from `nodejs22.x` to
`nodejs24.x` (in-place update), the `BucketDeployment` handler runs on
`arm64` and its handler / AWS CLI layer assets are updated, and the
empty `SourceMarkers` entries on the two `Custom::CDKBucketDeployment`
resources are dropped. ampless's own Lambda functions stay on
`nodejs22.x` with unchanged code assets.
