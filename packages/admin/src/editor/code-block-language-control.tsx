'use client'

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Braces } from 'lucide-react'
import { Input } from '@ampless/runtime/ui'
import { useT } from '../components/i18n-provider.js'
import { normalizeCodeLanguage } from './code-language.js'

interface CodeBlockLanguageControlProps {
  editor: Editor
}

export function CodeBlockLanguageControl({ editor }: CodeBlockLanguageControlProps) {
  const t = useT()

  // Synced state driven by selectionUpdate / transaction events.
  const [state, setState] = useState({ active: false, language: '' })

  // Local typed value — shown in the Input while the user is editing.
  const [localValue, setLocalValue] = useState('')

  // Whether the Input is currently focused (don't reseed while user is typing).
  const focusedRef = useRef(false)

  // The language value from the last sync that set localValue, so we can
  // detect when the active code block changes (different language) and reseed.
  const lastSeededLanguageRef = useRef<string>('')

  useEffect(() => {
    const sync = () => {
      const active = editor.isActive('codeBlock')
      const language = (editor.getAttributes('codeBlock').language as string | null) ?? ''
      setState({ active, language })

      // Reseed the local input when:
      //  - The Input is not currently focused (user is not mid-typing), OR
      //  - The active code block has changed (language seed differs from the
      //    normalised value the user had previously entered, meaning the cursor
      //    moved to a different block).
      if (!focusedRef.current || language !== lastSeededLanguageRef.current) {
        setLocalValue(language)
        lastSeededLanguageRef.current = language
      }
    }

    sync()
    editor.on('selectionUpdate', sync)
    editor.on('transaction', sync)
    return () => {
      editor.off('selectionUpdate', sync)
      editor.off('transaction', sync)
    }
  }, [editor])

  if (!state.active) return null

  return (
    <div className="flex items-center gap-1">
      <Braces className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <Input
        type="text"
        className="h-8 w-32 text-xs"
        value={localValue}
        title={t('editor.codeBlock.languageLabel')}
        placeholder={t('editor.codeBlock.languagePlaceholder')}
        aria-label={t('editor.codeBlock.languageLabel')}
        onFocus={() => {
          focusedRef.current = true
        }}
        onBlur={() => {
          focusedRef.current = false
          // On blur, reseed from the committed attribute so the field shows
          // the normalised value (e.g. 'c++' typed → 'c' after blur).
          const committed =
            (editor.getAttributes('codeBlock').language as string | null) ?? ''
          setLocalValue(committed)
          lastSeededLanguageRef.current = committed
        }}
        onChange={(e) => {
          const raw = e.target.value
          setLocalValue(raw)
          // Commit the normalised value (or null to clear) without stealing focus.
          editor
            .chain()
            .updateAttributes('codeBlock', { language: normalizeCodeLanguage(raw) })
            .run()
        }}
      />
    </div>
  )
}
