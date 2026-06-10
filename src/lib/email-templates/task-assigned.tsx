import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

const SITE_NAME = 'Working Capital Compass'

interface TaskAssignedProps {
  employeeName?: string
  taskTitle?: string
  taskDescription?: string
  dueDate?: string
  assignedBy?: string
  clientName?: string
}

const TaskAssignedEmail = ({
  employeeName,
  taskTitle,
  taskDescription,
  dueDate,
  assignedBy,
  clientName,
}: TaskAssignedProps) => (
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
          {dueDate ? (
            <Text style={meta}>
              <strong>Due:</strong> {dueDate}
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

export const template = {
  component: TaskAssignedEmail,
  subject: (data: Record<string, any>) =>
    data?.taskTitle ? `New task: ${data.taskTitle}` : 'You have a new task',
  displayName: 'Task assigned',
  previewData: {
    employeeName: 'Sam',
    taskTitle: 'Reconcile bank statements',
    taskDescription: 'Match all September transactions in Xero against the bank feed.',
    dueDate: '2026-05-20',
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
