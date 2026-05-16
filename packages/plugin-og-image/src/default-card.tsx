// Default OG image layout, painted by Satori inside Next.js ImageResponse.
//
// IMPORTANT: Satori does NOT support className / Tailwind / external CSS.
// Every style must be inline. Flex layouts work; CSS grid does not. See
// https://github.com/vercel/satori#documentation for the full subset.

import type { ReactElement } from 'react'

export interface DefaultCardProps {
  title: string
  excerpt?: string
  siteName: string
  /** Optional pre-decoded data URL — produced by loadImageForOg(). */
  imageDataUrl?: string | null
  /** Font name registered with ogImagePlugin's `fonts` array. */
  fontFamily: string
}

export function DefaultCard(props: DefaultCardProps): ReactElement {
  const { title, excerpt, siteName, imageDataUrl, fontFamily } = props

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        backgroundColor: '#ffffff',
        padding: 64,
        fontFamily,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          flex: 1,
          // Leave room for the image on the right when present, otherwise
          // let the text occupy the whole card.
          paddingRight: imageDataUrl ? 48 : 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              color: '#111111',
              lineHeight: 1.2,
              // Satori has no text-overflow:ellipsis — but it does clip to
              // the box. A high lineClamp is the recommended hint.
              display: 'flex',
            }}
          >
            {title}
          </div>
          {excerpt ? (
            <div
              style={{
                fontSize: 28,
                color: '#555555',
                lineHeight: 1.4,
                marginTop: 24,
                display: 'flex',
              }}
            >
              {excerpt}
            </div>
          ) : null}
        </div>
        <div
          style={{
            fontSize: 24,
            color: '#888888',
            display: 'flex',
          }}
        >
          {siteName}
        </div>
      </div>
      {imageDataUrl ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 400,
            height: 400,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageDataUrl}
            width={400}
            height={400}
            style={{
              width: 400,
              height: 400,
              borderRadius: 16,
              objectFit: 'cover',
            }}
            alt=""
          />
        </div>
      ) : null}
    </div>
  )
}
