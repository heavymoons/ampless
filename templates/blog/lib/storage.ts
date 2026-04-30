import outputs from '../amplify_outputs.json'

interface StorageOutput {
  bucket_name: string
  aws_region: string
}

export const storage = (outputs as { storage?: StorageOutput }).storage ?? null

export function publicAssetUrl(key: string): string | null {
  if (!storage) return null
  return `https://${storage.bucket_name}.s3.${storage.aws_region}.amazonaws.com/${key}`
}
