import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/unsubscribe')({
  component: UnsubscribePage,
  validateSearch: (s: Record<string, unknown>) => ({ token: (s.token as string) ?? '' }),
})

function UnsubscribePage() {
  const { token } = Route.useSearch()
  const [state, setState] = useState<'loading' | 'valid' | 'already' | 'invalid' | 'done' | 'error'>('loading')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) { setState('invalid'); return }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        if (d.valid) setState('valid')
        else if (d.reason === 'already_unsubscribed') setState('already')
        else setState('invalid')
      })
      .catch(() => setState('error'))
  }, [token])

  const confirm = async () => {
    setSubmitting(true)
    try {
      const r = await fetch('/email/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const d = await r.json()
      if (d.success) setState('done')
      else if (d.reason === 'already_unsubscribed') setState('already')
      else setState('error')
    } catch {
      setState('error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>Unsubscribe</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          {state === 'loading' && <p className="text-muted-foreground">Checking link…</p>}
          {state === 'invalid' && <p>This unsubscribe link is invalid or has expired.</p>}
          {state === 'already' && <p>You're already unsubscribed. No further action needed.</p>}
          {state === 'error' && <p className="text-destructive">Something went wrong. Please try again.</p>}
          {state === 'valid' && (
            <>
              <p>Click confirm to stop receiving emails from us.</p>
              <Button onClick={confirm} disabled={submitting} className="w-full">
                {submitting ? 'Processing…' : 'Confirm unsubscribe'}
              </Button>
            </>
          )}
          {state === 'done' && <p>You have been unsubscribed.</p>}
        </CardContent>
      </Card>
    </div>
  )
}
