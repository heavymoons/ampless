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
import {
  Button,
  Input,
  Label,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@ampless/runtime/ui'
import { useT } from './i18n-provider.js'

type Mode = 'signIn' | 'signUp' | 'confirm' | 'forgot' | 'reset'

export function LoginPage() {
  const router = useRouter()
  const t = useT()
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
          setError(t('auth.additionalStep', { step: result.nextStep.signInStep }))
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
        setInfo(t('auth.forgot.codeSent'))
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
          setInfo(t('auth.reset.passwordUpdated'))
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
          <CardTitle>{t(`auth.${mode}.title`)}</CardTitle>
          <CardDescription>{t(`auth.${mode}.description`)}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {showEmail && (
              <div className="space-y-2">
                <Label htmlFor="email">{t('auth.common.email')}</Label>
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
                <Label htmlFor="code">{t('auth.common.code')}</Label>
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
                  {mode === 'reset' ? t('auth.common.newPassword') : t('auth.common.password')}
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
                    {t('auth.common.passwordHint')}
                  </p>
                )}
              </div>
            )}

            {info && <p className="text-sm text-muted-foreground">{info}</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('auth.common.working') : t(`auth.${mode}.submit`)}
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
                      {t('auth.signIn.forgotPassword')}
                    </button>
                  </p>
                  <p>
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => go('signUp')}
                    >
                      {t('auth.signIn.createAccount')}
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
                    {t('auth.signUp.backToSignIn')}
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
                    {t('auth.reset.resendCode')}
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
