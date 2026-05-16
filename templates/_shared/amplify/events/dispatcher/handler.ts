// Re-exported from @ampless/backend so the package can ship Lambda
// handler updates via `npm update`. Amplify's esbuild follows this
// import and bundles the real handler into the Lambda artifact.
export { handler } from '@ampless/backend/events/dispatcher'
