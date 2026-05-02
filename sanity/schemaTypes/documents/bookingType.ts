import { defineType, defineField } from 'sanity'
import { CalendarIcon } from '@sanity/icons'

const STATUS_OPTIONS = [
  { title: 'Confirmed', value: 'confirmed' },
  { title: 'Cancelled', value: 'cancelled' },
  { title: 'Rescheduled', value: 'rescheduled' },
] as const

export const bookingType = defineType({
  name: 'bookingType',
  title: 'Booking',
  type: 'document',
  icon: CalendarIcon,
  groups: [
    { name: 'refs', title: 'References' },
    { name: 'snapshot', title: 'Snapshot' },
    { name: 'time', title: 'Time' },
    { name: 'invitee', title: 'Invitee' },
    { name: 'lifecycle', title: 'Lifecycle' },
  ],
  fields: [
    defineField({
      name: 'host',
      type: 'reference',
      to: [{ type: 'userType' }],
      group: 'refs',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'meetingType',
      type: 'reference',
      to: [{ type: 'meetingType' }],
      group: 'refs',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'bookingToken',
      type: 'string',
      description: 'Unguessable public token used in the confirmation URL. Set server-side at booking time.',
      group: 'refs',
      readOnly: true,
      validation: (rule) => rule.required().min(20).max(40),
    }),

    defineField({
      name: 'meetingTitleSnapshot',
      type: 'string',
      group: 'snapshot',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'meetingDurationSnapshot',
      type: 'number',
      group: 'snapshot',
      validation: (rule) => rule.required().integer().min(1),
    }),
    defineField({
      name: 'hostNameSnapshot',
      type: 'string',
      group: 'snapshot',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'hostUsernameSnapshot',
      type: 'string',
      group: 'snapshot',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'locationSnapshot',
      type: 'location',
      group: 'snapshot',
      validation: (rule) => rule.required(),
    }),

    defineField({
      name: 'startTime',
      type: 'datetime',
      group: 'time',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'endTime',
      type: 'datetime',
      group: 'time',
      validation: (rule) =>
        rule.required().custom((end, context) => {
          const doc = context.document as
            | { startTime?: string; meetingDurationSnapshot?: number }
            | undefined
          const start = doc?.startTime
          const duration = doc?.meetingDurationSnapshot
          if (!end || !start || typeof duration !== 'number') return true
          const expected = new Date(new Date(start).getTime() + duration * 60_000).toISOString()
          return expected === end || `End time must equal startTime + ${duration} minutes`
        }),
    }),
    defineField({
      name: 'inviteeTimezone',
      type: 'string',
      group: 'time',
      validation: (rule) => rule.required(),
    }),

    defineField({
      name: 'inviteeName',
      type: 'string',
      group: 'invitee',
      validation: (rule) => rule.required().min(1),
    }),
    defineField({
      name: 'inviteeEmail',
      type: 'string',
      group: 'invitee',
      validation: (rule) => rule.required().email(),
    }),
    defineField({ name: 'inviteeNotes', type: 'text', rows: 3, group: 'invitee' }),

    defineField({
      name: 'status',
      type: 'string',
      options: { list: [...STATUS_OPTIONS], layout: 'radio' },
      initialValue: 'confirmed',
      group: 'lifecycle',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'cancellationReason',
      type: 'text',
      group: 'lifecycle',
      hidden: ({ parent }) => parent?.status !== 'cancelled',
      validation: (rule) =>
        rule.custom((value, context) => {
          const status = (context.document as { status?: string } | undefined)?.status
          if (status === 'cancelled' && !value) return 'Required when status is cancelled'
          return true
        }),
    }),
    defineField({
      name: 'rescheduledTo',
      type: 'reference',
      to: [{ type: 'bookingType' }],
      group: 'lifecycle',
      hidden: ({ parent }) => parent?.status !== 'rescheduled',
      validation: (rule) =>
        rule.custom((value, context) => {
          const status = (context.document as { status?: string } | undefined)?.status
          if (status === 'rescheduled' && !value) return 'Required when status is rescheduled'
          return true
        }),
    }),
    defineField({
      name: 'cancelledAt',
      type: 'datetime',
      group: 'lifecycle',
      hidden: ({ parent }) => parent?.status !== 'cancelled',
    }),
    defineField({
      name: 'createdAt',
      type: 'datetime',
      readOnly: true,
      group: 'lifecycle',
      initialValue: () => new Date().toISOString(),
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: {
      invitee: 'inviteeName',
      host: 'hostNameSnapshot',
      meeting: 'meetingTitleSnapshot',
      startTime: 'startTime',
      status: 'status',
    },
    prepare: ({ invitee, host, meeting, startTime, status }) => ({
      title: `${invitee ?? '?'} → ${host ?? '?'}`,
      subtitle: `${meeting ?? ''} · ${startTime ?? ''} · ${status ?? ''}`,
    }),
  },
  orderings: [
    {
      title: 'Start time (newest first)',
      name: 'startDesc',
      by: [{ field: 'startTime', direction: 'desc' }],
    },
  ],
})
