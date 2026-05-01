'use client'

import { useEffect } from 'react'
import '@/lib/amplify'
import '@/lib/posts-provider'
import '@/lib/kv-provider'

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Amplify is configured via the side-effect import above
  }, [])
  return <>{children}</>
}
