'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * A table custom class the active theme declares (ThemeManifest.customClasses
 * with target 'table'), with its label already resolved for the admin locale.
 * Serializable so the server page factory can pass it to the client editor.
 */
export interface EditorTableClass {
  id: string
  label: string
  description?: string
}

const TableClassesContext = createContext<ReadonlyArray<EditorTableClass>>([])

/** Provides the active theme's table classes to the editor's table controls. */
export function TableClassesProvider({
  classes,
  children,
}: {
  classes: ReadonlyArray<EditorTableClass> | undefined
  children: ReactNode
}) {
  return <TableClassesContext.Provider value={classes ?? []}>{children}</TableClassesContext.Provider>
}

export function useTableClasses(): ReadonlyArray<EditorTableClass> {
  return useContext(TableClassesContext)
}
