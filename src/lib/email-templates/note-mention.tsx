import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const SITE_NAME = 'Milōn'

interface NoteMentionProps {
  recipientName?: string
  authorName?: string
  clientName?: string
  noteText?: string
  tabLabel?: string
}

const NoteMentionEmail = ({
  recipientName,
  authorName,
  clientName,
  noteText,
  tabLabel,
}: NoteMentionProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      {authorName
        ? `${authorName} mentioned you on a note${clientName ? ` for ${clientName}` : ''}`
        : 'You were mentioned on a client note'}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {recipientName ? `Hi ${recipientName},` : 'Hello,'}
        </Heading>
        <Text style={text}>
          {authorName ? <strong>{authorName}</strong> : 'Someone'} mentioned you
          on a note
          {clientName ? (
            <>
              {' '}for <strong>{clientName}</strong>
            </>
          ) : null}
          {tabLabel ? <> ({tabLabel})</> : null}.
        </Text>

        <Section style={card}>
          <Text style={noteBody}>{noteText ?? 'Open Milōn to read the note.'}</Text>
        </Section>

        <Text style={text}>
          Log in to {SITE_NAME} to view the note on this client&apos;s workspace.
          Only people tagged with @ are emailed — everyone with access can still
          see the note in-app.
        </Text>

        <Text style={footer}>— The {SITE_NAME} team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: NoteMentionEmail,
  subject: (data: Record<string, any>) =>
    data?.clientName
      ? `${data.authorName ?? 'Someone'} mentioned you on ${data.clientName}`
      : `${data?.authorName ?? 'Someone'} mentioned you on a note`,
  displayName: 'Note mention',
  previewData: {
    recipientName: 'Thabo',
    authorName: 'Sara (Accountant)',
    clientName: 'Acme Bakery',
    noteText: '@Thabo can you confirm June debtor days before we sign off?',
    tabLabel: 'Health & Ratios',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '20px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#334155', lineHeight: '1.5', margin: '0 0 16px' }
const card = {
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  padding: '16px 18px',
  margin: '8px 0 20px',
  backgroundColor: '#f8fafc',
}
const noteBody = { fontSize: '14px', color: '#0f172a', lineHeight: '1.5', margin: 0, whiteSpace: 'pre-wrap' as const }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '24px 0 0' }
