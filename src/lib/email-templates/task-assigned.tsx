import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'
import { formatCalendarDay, type DateMarket } from '@/lib/market/format'
import { marketForClient } from '@/lib/market/scope'

function shownDue(dueDate: string | undefined, market: DateMarket): string | null {
  if (!dueDate) return null
  const formatted = formatCalendarDay(dueDate, market)
  return formatted === '—' ? dueDate : formatted
}

const SITE_NAME = 'Milōn'

interface TaskAssignedProps {
  employeeName?: string
  taskTitle?: string
  taskDescription?: string
  dueDate?: string
  assignedBy?: string
  clientName?: string
  market?: DateMarket | null
}

const TaskAssignedEmail = ({
  employeeName,
  taskTitle,
  taskDescription,
  dueDate,
  assignedBy,
  clientName,
  market,
}: TaskAssignedProps) => {
  const due = shownDue(dueDate, market ?? marketForClient(null))
  return (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{taskTitle ? `New task: ${taskTitle}` : 'You have a new task'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {employeeName ? `Hi ${employeeName},` : 'Hello,'}
        </Heading>
        <Text style={text}>
          {assignedBy ? `${assignedBy} has` : 'You have been'} assigned a new task
          {clientName ? ` for ${clientName}` : ''}.
        </Text>

        <Section style={card}>
          <Text style={taskTitleStyle}>{taskTitle ?? 'New task'}</Text>
          {taskDescription ? (
            <Text style={taskDesc}>{taskDescription}</Text>
          ) : null}
          {due ? (
            <Text style={meta}>
              <strong>Due:</strong> {due}
            </Text>
          ) : null}
        </Section>

        <Text style={text}>
          Log in to {SITE_NAME} to view and complete this task.
        </Text>

        <Text style={footer}>— The {SITE_NAME} team</Text>
      </Container>
    </Body>
    </Html>
  )
}

export const template = {
  component: TaskAssignedEmail,
  subject: (data: Record<string, any>) =>
    data?.taskTitle ? `New task: ${data.taskTitle}` : 'You have a new task',
  displayName: 'Task assigned',
  previewData: {
    employeeName: 'Sam',
    taskTitle: 'Reconcile bank statements',
    taskDescription: 'Match all September transactions in Xero against the bank feed.',
    dueDate: '20 May 2026',
    assignedBy: 'Alex',
    clientName: 'Acme Bakery',
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
const taskTitleStyle = { fontSize: '16px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 8px' }
const taskDesc = { fontSize: '14px', color: '#475569', lineHeight: '1.5', margin: '0 0 8px' }
const meta = { fontSize: '13px', color: '#64748b', margin: '8px 0 0' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '24px 0 0' }
