'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn, signUp, confirmSignUp } from 'aws-amplify/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

type Mode = 'signIn' | 'signUp' | 'confirm'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (mode === 'signIn') {
        const result = await signIn({ username: email, password })
        if (result.isSignedIn) {
          router.push('/admin')
          router.refresh()
        } else {
          setError(`Sign-in needs additional step: ${result.nextStep.signInStep}`)
        }
      } else if (mode === 'signUp') {
        await signUp({
          username: email,
          password,
          options: { userAttributes: { email } },
        })
        setMode('confirm')
      } else {
        await confirmSignUp({ username: email, confirmationCode: code })
        const result = await signIn({ username: email, password })
        if (result.isSignedIn) {
          router.push('/admin')
          router.refresh()
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {mode === 'signIn' ? 'Sign in' : mode === 'signUp' ? 'Create admin account' : 'Confirm email'}
          </CardTitle>
          <CardDescription>
            {mode === 'signIn'
              ? 'Sign in to manage your site.'
              : mode === 'signUp'
                ? 'The first user becomes the site admin.'
                : 'Enter the verification code sent to your email.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode !== 'confirm' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                  />
                  {mode === 'signUp' && (
                    <p className="text-xs text-muted-foreground">
                      Min 8 chars, with upper, lower, number, and symbol.
                    </p>
                  )}
                </div>
              </>
            )}

            {mode === 'confirm' && (
              <div className="space-y-2">
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Working...' : mode === 'signIn' ? 'Sign in' : mode === 'signUp' ? 'Sign up' : 'Confirm'}
            </Button>

            {mode === 'signIn' && (
              <p className="text-center text-sm">
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setMode('signUp')}
                >
                  Create admin account
                </button>
              </p>
            )}
            {mode === 'signUp' && (
              <p className="text-center text-sm">
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setMode('signIn')}
                >
                  Already have an account? Sign in
                </button>
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
