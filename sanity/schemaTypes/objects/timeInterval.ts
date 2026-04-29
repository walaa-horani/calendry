import { defineType, defineField } from 'sanity'

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

export const timeInterval = defineType({
  name: 'timeInterval',
  title: 'Time interval',
  type: 'object',
  fields: [
    defineField({
      name: 'start',
      title: 'Start (HH:mm)',
      type: 'string',
      validation: (rule) =>
        rule
          .required()
          .regex(TIME_REGEX, { name: 'HH:mm' })
          .error('Use HH:mm 24-hour format, e.g. 09:00'),
    }),
    defineField({
      name: 'end',
      title: 'End (HH:mm)',
      type: 'string',
      validation: (rule) =>
        rule
          .required()
          .regex(TIME_REGEX, { name: 'HH:mm' })
          .custom((end, context) => {
            const parent = context.parent as { start?: string } | undefined
            const start = parent?.start
            if (!start || !end) return true
            return end > start || 'End time must be after start time'
          }),
    }),
  ],
  preview: {
    select: { start: 'start', end: 'end' },
    prepare: ({ start, end }) => ({
      title: `${start ?? '??:??'} – ${end ?? '??:??'}`,
    }),
  },
})
