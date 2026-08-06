import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface ActionTaskProps {
  employeeName?: string
  taskTitle?: string
  outcomeWhy?: string
  dueDate?: string
  periodLabel?: string
  outcomeGoal?: string
  milestones?: { week_no: number; label: string }[]
  taskUrl?: string
  assignedBy?: string
  clientName?: string
  emailType?: 'assignment' | 'nudge' | 'overdue' | 'done'
}

/**
 * Plain, personal, short. From a colleague, not from software.
 * All buttons are GETs carrying ?intent= — they open the task page
 * and change nothing. The mutation only ever happens on POST from
 * that page (mail scanners prefetch every link in an email).
 */
const ActionTaskEmail = ({
  employeeName,
  taskTitle,
  outcomeWhy,
  dueDate,
  periodLabel,
  milestones,
  taskUrl,
  assignedBy,
  clientName,
  emailType = 'assignment',
}: ActionTaskProps) => {
  const intro =
    emailType === 'nudge'
      ? `A reminder — this one is due soon:`
      : emailType === 'overdue'
        ? `This one is now past its due date:`
        : `You own this one in the ${periodLabel ?? 'current'} action plan:`
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{taskTitle ? `${taskTitle}${dueDate ? ` — due ${dueDate}` : ''}` : 'Your task'}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{employeeName ? `Hi ${employeeName},` : 'Hello,'}</Heading>
          <Text style={text}>{intro}</Text>

          <Section style={card}>
            <Text style={taskTitleStyle}>{(taskTitle ?? 'Your task').toUpperCase()}</Text>
            {dueDate ? <Text style={meta}>Due {dueDate}</Text> : null}
            {outcomeWhy ? (
              <Text style={why}>
                <strong>Why it matters:</strong> {outcomeWhy}
              </Text>
            ) : null}
            {milestones && milestones.length > 0 ? (
              <>
                <Text style={metaLabel}>Working backwards:</Text>
                {milestones.map((m) => (
                  <Text key={m.week_no} style={milestone}>
                    W{m.week_no}&nbsp;&nbsp;{m.label}
                  </Text>
                ))}
              </>
            ) : null}
          </Section>

          {taskUrl ? (
            <Section style={{ margin: '20px 0' }}>
              <Button style={btnPrimary} href={`${taskUrl}?intent=in_progress`}>
                I'm on it
              </Button>
              <Button style={btnGhost} href={`${taskUrl}?intent=done`}>
                Mark as done
              </Button>
              <Button style={btnGhost} href={`${taskUrl}?intent=blocked`}>
                I'm blocked
              </Button>
            </Section>
          ) : null}

          <Text style={small}>No login needed — the buttons open your task page.</Text>
          <Text style={footer}>
            — MILŌN{assignedBy ? `, on behalf of ${assignedBy}` : ''}
            {clientName ? ` · ${clientName}` : ''}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: ActionTaskEmail,
  subject: (data: Record<string, any>) =>
    data?.taskTitle
      ? `${data.taskTitle}${data.dueDate ? ` — due ${data.dueDate}` : ''}`
      : 'Your task in the action plan',
  displayName: 'Action plan task',
  previewData: {
    employeeName: 'Lindiwe',
    taskTitle: 'Reduce Debtor Days to under 30 days',
    outcomeWhy: 'Faster cash in means more liquidity and less reliance on debt.',
    dueDate: '30 September 2026',
    periodLabel: 'Q3 2026',
    milestones: [
      { week_no: 1, label: 'Top 20 debtors plan' },
      { week_no: 2, label: 'Payment terms comms' },
    ],
    taskUrl: 'https://example.com/t/token',
    assignedBy: 'Theo W.',
    clientName: 'Acme Bakery',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '600px' }
const h1 = { fontSize: '18px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 14px' }
const text = { fontSize: '14px', color: '#334155', lineHeight: '1.5', margin: '0 0 14px' }
const card = {
  border: '1px solid #e7dcc3',
  borderLeft: '3px solid #b8860b',
  borderRadius: '8px',
  padding: '16px 18px',
  margin: '8px 0 4px',
  backgroundColor: '#fdfaf3',
}
const taskTitleStyle = { fontSize: '15px', fontWeight: 'bold', letterSpacing: '0.04em', color: '#0f172a', margin: '0 0 6px' }
const why = { fontSize: '13px', color: '#475569', lineHeight: '1.5', margin: '10px 0 0' }
const meta = { fontSize: '13px', color: '#b8860b', fontWeight: 'bold', margin: '0' }
const metaLabel = { fontSize: '12px', color: '#64748b', margin: '12px 0 4px', fontWeight: 'bold' }
const milestone = { fontSize: '13px', color: '#475569', margin: '0 0 2px', fontFamily: 'Menlo, monospace' }
const btnPrimary = {
  backgroundColor: '#b8860b', color: '#ffffff', fontSize: '13px', fontWeight: 'bold',
  padding: '10px 16px', borderRadius: '6px', textDecoration: 'none', marginRight: '8px',
}
const btnGhost = {
  backgroundColor: '#f1f5f9', color: '#0f172a', fontSize: '13px', fontWeight: 'bold',
  padding: '10px 16px', borderRadius: '6px', textDecoration: 'none', marginRight: '8px',
}
const small = { fontSize: '12px', color: '#94a3b8', margin: '4px 0 0' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '20px 0 0' }
