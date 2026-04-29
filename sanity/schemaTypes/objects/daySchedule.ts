import { defineType, defineField, defineArrayMember } from 'sanity'

const DAYS = [
  { title: 'Monday', value: 'mon' },
  { title: 'Tuesday', value: 'tue' },
  { title: 'Wednesday', value: 'wed' },
  { title: 'Thursday', value: 'thu' },
  { title: 'Friday', value: 'fri' },
  { title: 'Saturday', value: 'sat' },
  { title: 'Sunday', value: 'sun' },
] as const

export const daySchedule = defineType({
  name: 'daySchedule',
  title: 'Day schedule',
  type: 'object',
  fields: [
    defineField({
      name: 'day',
      type: 'string',
      options: { list: [...DAYS], layout: 'dropdown' },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'enabled',
      type: 'boolean',
      initialValue: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'intervals',
      type: 'array',
      of: [defineArrayMember({ type: 'timeInterval' })],
      validation: (rule) =>
        rule.custom((intervals, context) => {
          const parent = context.parent as { enabled?: boolean } | undefined
          const list = (intervals as Array<{ start?: string; end?: string }> | undefined) ?? []
          if (parent?.enabled && list.length === 0) {
            return 'Add at least one interval when this day is enabled'
          }
          for (let i = 1; i < list.length; i++) {
            const prev = list[i - 1]
            const curr = list[i]
            if (!prev?.start || !prev?.end || !curr?.start) continue
            if (prev.end > curr.start) {
              return 'Intervals must be sorted ascending and non-overlapping'
            }
          }
          return true
        }),
    }),
  ],
  preview: {
    select: { day: 'day', enabled: 'enabled', intervals: 'intervals' },
    prepare: ({ day, enabled, intervals }) => {
      const count = (intervals as unknown[] | undefined)?.length ?? 0
      const dayLabel = DAYS.find((d) => d.value === day)?.title ?? 'Unset'
      return {
        title: dayLabel,
        subtitle: enabled ? `${count} interval(s)` : 'Disabled',
      }
    },
  },
})
