import { defineType, defineField, defineArrayMember } from 'sanity'
import { ClockIcon } from '@sanity/icons'

const REQUIRED_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export const availabilityType = defineType({
  name: 'availabilityType',
  title: 'Schedule',
  type: 'document',
  icon: ClockIcon,
  fields: [
    defineField({
      name: 'user',
      type: 'reference',
      to: [{ type: 'userType' }],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'timezone',
      type: 'string',
      description: 'IANA timezone in which the local times below are interpreted.',
      initialValue: 'UTC',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'weeklySchedule',
      type: 'array',
      of: [defineArrayMember({ type: 'daySchedule' })],
      validation: (rule) =>
        rule.required().custom((days) => {
          const list = (days as Array<{ day?: string }> | undefined) ?? []
          if (list.length !== 7) return 'Must contain exactly 7 day entries (one per weekday)'
          const seen = new Set<string>()
          for (const d of list) {
            if (!d.day) return 'Each day entry must specify a day'
            if (seen.has(d.day)) return `Duplicate day: ${d.day}`
            seen.add(d.day)
          }
          for (const required of REQUIRED_DAYS) {
            if (!seen.has(required)) return `Missing day: ${required}`
          }
          return true
        }),
    }),
    defineField({
      name: 'minimumNotice',
      title: 'Minimum notice (minutes)',
      type: 'number',
      initialValue: 240,
      validation: (rule) => rule.required().integer().min(0),
    }),
    defineField({
      name: 'bufferBefore',
      title: 'Buffer before (minutes)',
      type: 'number',
      initialValue: 0,
      validation: (rule) => rule.required().integer().min(0),
    }),
    defineField({
      name: 'bufferAfter',
      title: 'Buffer after (minutes)',
      type: 'number',
      initialValue: 0,
      validation: (rule) => rule.required().integer().min(0),
    }),
  ],
  preview: {
    select: { userName: 'user.displayName', timezone: 'timezone' },
    prepare: ({ userName, timezone }) => ({
      title: userName ? `${userName}'s availability` : 'Schedule (no user)',
      subtitle: timezone ?? undefined,
    }),
  },
})
