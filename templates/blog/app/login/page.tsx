'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  signIn,
  signUp,
  confirmSignUp,
  resetPassword,
  confirmResetPassword,
} from 'aws-amplify/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

type Mode = 'signIn' | 'signUp' | 'confirm' | 'forgot' | 'reset'

const TITLES: Record<Mode, string> = {
  signIn: 'Sign in',
  signUp: 'Create admin account',
  confirm: 'Confirm email',
  forgot: 'Reset password',
  reset: 'Set new password',
}

const DESCRIPTIONS: Record<Mode, string> = {
  signIn: 'Sign in to manage your site.',
  signUp: 'The first user becomes the site admin.',
  confirm: 'Enter the verification code sent to your email.',
  forgot: 'We\'ll email you a verification code.',
  reset: 'Enter the code from your email and a new password.',
}

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function go(next: Mode) {
    setMode(next)
    setError(null)
    setInfo(null)
    setCode('')
    if (next === 'signIn' || next === 'signUp' || next === 'forgot') setPassword('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
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
        go('confirm')
      } else if (mode === 'confirm') {
        await confirmSignUp({ username: email, confirmationCode: code })
        const result = await signIn({ username: email, password })
        if (result.isSignedIn) {
          router.push('/admin')
          router.refresh()
        }
      } else if (mode === 'forgot') {
        await resetPassword({ username: email })
        setMode('reset')
        setInfo('Verification code sent. Check your email.')
      } else if (mode === 'reset') {
        await confirmResetPassword({
          username: email,
          confirmationCode: code,
          newPassword: password,
        })
        const result = await signIn({ username: email, password })
        if (result.isSignedIn) {
          router.push('/admin')
          router.refresh()
        } else {
          setMode('signIn')
          setInfo('Password updated. Please sign in.')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const showEmail = mode !== 'confirm' && mode !== 'reset'
  const showPassword = mode === 'signIn' || mode === 'signUp' || mode === 'reset'
  const showCode = mode === 'confirm' || mode === 'reset'

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{TITLES[mode]}</CardTitle>
          <CardDescription>{DESCRIPTIONS[mode]}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {showEmail && (
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
            )}

            {showCode && (
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

            {showPassword && (
              <div className="space-y-2">
                <Label htmlFor="password">
                  {mode === 'reset' ? 'New password' : 'Password'}
                </Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={
                    mode === 'signIn' ? 'current-password' : 'new-password'
                  }
                />
                {(mode === 'signUp' || mode === 'reset') && (
                  <p className="text-xs text-muted-foreground">
                    Min 8 chars, with upper, lower, number, and symbol.
                  </p>
                )}
              </div>
            )}

            {info && <p className="text-sm text-muted-foreground">{info}</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? 'Working...'
                : mode === 'signIn'
                  ? 'Sign in'
                  : mode === 'signUp'
                    ? 'Sign up'
                    : mode === 'confirm'
                      ? 'Confirm'
                      : mode === 'forgot'
                        ? 'Send code'
                        : 'Update password'}
            </Button>

            <div className="space-y-1 text-center text-sm">
              {mode === 'signIn' && (
                <>
                  <p>
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => go('forgot')}
                    >
                      Forgot password?
                    </button>
                  </p>
                  <p>
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => go('signUp')}
                    >
                      Create admin account
                    </button>
                  </p>
                </>
              )}
              {(mode === 'signUp' || mode === 'forgot' || mode === 'reset') && (
                <p>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => go('signIn')}
                  >
                    Back to sign in
                  </button>
                </p>
              )}
              {mode === 'reset' && (
                <p>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => go('forgot')}
                  >
                    Resend code
                  </button>
                </p>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
