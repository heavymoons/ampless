'use client'

import { useEffect, useState } from 'react'

interface LightboxBinderProps {
  scopeSelector: string
  /** Site default. Per-image data-display always wins over this. */
  defaultLightbox?: boolean
}

// Wires click-to-enlarge for images inside any element. An image opts in
// when either its `data-display="lightbox"` attribute is set or the site
// default enables it (and the image hasn't opted out via data-display="inline").
export function LightboxBinder({ scopeSelector, defaultLightbox = false }: LightboxBinderProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [alt, setAlt] = useState<string>('')

  useEffect(() => {
    const root = document.querySelector(scopeSelector)
    if (!root) return
    const imgs = root.querySelectorAll<HTMLImageElement>('img')
    const cleanup: Array<() => void> = []
    imgs.forEach((img) => {
      const display = img.dataset.display
      const enabled = display === 'lightbox' || (display !== 'inline' && defaultLightbox)
      if (!enabled) return
      img.style.cursor = 'zoom-in'
      const onClick = () => {
        setSrc(img.src)
        setAlt(img.alt)
      }
      img.addEventListener('click', onClick)
      cleanup.push(() => img.removeEventListener('click', onClick))
    })
    return () => {
      cleanup.forEach((fn) => fn())
    }
  }, [scopeSelector, defaultLightbox])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSrc(null)
    }
    if (src) {
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }
  }, [src])

  if (!src) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={() => setSrc(null)}
      role="dialog"
      aria-modal="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full object-contain"
        style={{ cursor: 'zoom-out' }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
