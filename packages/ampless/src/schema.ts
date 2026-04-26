export type FieldType = 'string' | 'text' | 'number' | 'boolean' | 'datetime' | 'image' | 'reference'

export interface FieldDefinition {
  type: FieldType
  label?: string
  required?: boolean
  default?: unknown
}

export interface ContentTypeDefinition {
  name: string
  label: string
  fields: Record<string, FieldDefinition>
}

export function defineSchema<T extends Record<string, ContentTypeDefinition>>(schema: T): T {
  return schema
}
