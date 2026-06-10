import { supabase } from '@/integrations/supabase/client'

interface SendTransactionalEmailParams {
  templateName: string
  recipientEmail: string
  idempotencyKey?: string
  templateData?: Record<string, unknown>
}

export async function sendTransactionalEmail(params: SendTransactionalEmailParams) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/lovable/email/transactional/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Email send failed (${res.status}): ${text}`)
  }
  return res.json()
}
