import type { ReactNode } from 'react'
import type { PluginSettingField, PluginRepeatableField } from 'ampless'
import { Input, Textarea } from '@ampless/runtime/ui'

/**
 * Render a scalar (non-repeatable) plugin field input. Handles the 8
 * scalar variant types: text, url, textarea, code, boolean, number,
 * select, json.
 *
 * Lives in its own module (rather than in `plugin-settings-form`) so the
 * repeatable case can call back into it per sub-field cell without
 * `repeatable-field-editor` and `plugin-settings-form` importing each
 * other in a cycle.
 */
export function renderScalarInput(
  field: Exclude<PluginSettingField, PluginRepeatableField>,
  id: string,
  value: string,
  invalid: boolean,
  onChange: (v: string) => void
): ReactNode {
  switch (field.type) {
    case 'text':
    case 'url':
      return (
        <Input
          id={id}
          value={value}
          maxLength={field.type === 'text' ? field.maxLength : undefined}
          placeholder={'placeholder' in field ? field.placeholder : undefined}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
          type={field.type === 'url' ? 'url' : 'text'}
        />
      )
    case 'textarea':
      return (
        <Textarea
          id={id}
          value={value}
          rows={field.rows ?? 4}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
        />
      )
    case 'code':
      return (
        <div className="space-y-1">
          {field.language && (
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {field.language}
            </p>
          )}
          <Textarea
            id={id}
            value={value}
            rows={field.rows ?? 8}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid}
            className="font-mono text-xs"
          />
        </div>
      )
    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="checkbox"
            checked={value === 'true'}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
            className="h-4 w-4"
          />
          <span className="text-xs text-muted-foreground">
            {value === 'true' ? 'on' : 'off'}
          </span>
        </div>
      )
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          value={value}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
        />
      )
    case 'select':
      return (
        <select
          id={id}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
        >
          <option value="">—</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {typeof opt.label === 'string' ? opt.label : opt.value}
            </option>
          ))}
        </select>
      )
    case 'json':
      return (
        <Textarea
          id={id}
          value={value}
          rows={field.rows ?? 8}
          placeholder={field.placeholder ?? '{}'}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
          className="font-mono text-xs"
        />
      )
  }
}
