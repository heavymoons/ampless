import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/auth/post-confirmation.ts',
    'src/auth/user-admin.ts',
    'src/events/dispatcher.ts',
    'src/events/processor-trusted.ts',
    'src/events/processor-untrusted.ts',
    'src/functions/api-key-renewer.ts',
    'src/functions/mcp-handler.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  // Backend factories are consumed in two distinct contexts:
  //   1. The main entry (defineAmplessBackend, amplessAuthConfig,
  //      amplessStorageConfig, schema helpers) runs inside Amplify's
  //      CDK synth — `@aws-amplify/backend` and `aws-cdk-lib` are
  //      always already present in that environment, so they stay
  //      external (peer deps).
  //   2. Lambda handler entries (post-confirmation, dispatcher,
  //      processor-trusted/untrusted, api-key-renewer) are bundled
  //      a SECOND time by Amplify's esbuild step starting from the
  //      template's thin shell. That second bundle inlines whatever
  //      it needs from this package's dist. Keeping `@aws-sdk/*` as
  //      external here lets the Lambda runtime's bundled SDK v3 win
  //      (smaller cold-start payload) and matches how the handlers
  //      were structured pre-extraction.
  //   3. `ampless` is intentionally external — it's a workspace dep
  //      and ships its own dist; we re-bundle through the consumer.
  external: [
    '@aws-amplify/backend',
    'aws-cdk-lib',
    'aws-cdk-lib/aws-iam',
    'aws-cdk-lib/aws-s3',
    'aws-cdk-lib/aws-sqs',
    'aws-cdk-lib/aws-lambda',
    'aws-cdk-lib/aws-lambda-event-sources',
    'aws-cdk-lib/aws-events',
    'aws-cdk-lib/aws-events-targets',
    'aws-lambda',
    'ampless',
    '@aws-sdk/client-appsync',
    '@aws-sdk/client-cognito-identity-provider',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/client-s3',
    '@aws-sdk/client-sqs',
    '@aws-sdk/lib-dynamodb',
    '@aws-sdk/util-dynamodb',
  ],
})
