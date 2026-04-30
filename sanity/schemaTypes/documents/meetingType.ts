import { defineType, defineField } from 'sanity'
import { TagIcon } from '@sanity/icons'

const COLOR_OPTIONS = [
  { title: 'Blue', value: 'blue' },
  { title: 'Green', value: 'green' },
  { title: 'Purple', value: 'purple' },
  { title: 'Pink', value: 'pink' },
  { title: 'Orange', value: 'orange' },
  { title: 'Red', value: 'red' },
  { title: 'Gray', value: 'gray' },
] as const

const SLUG_REGEX = /^[a-z0-9-]+$/

export const meetingType = defineType({
  name: 'meetingType',
  title: 'Event type',
  type: 'document',
  icon: TagIcon,
  fields: [
    defineField({
      name: 'host',
      type: 'reference',
      to: [{ type: 'userType' }],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'title',
      type: 'string',
      validation: (rule) => rule.required().min(1).max(100),
    }),
    defineField({
      name: 'slug',
      type: 'slug',
      description: 'Public URL: /{username}/{slug}',
      options: {
        source: 'title',
        maxLength: 60,
        slugify: (input: string) =>
          input
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .slice(0, 60),
      },
      validation: (rule) =>
        rule.required().custom(async (slug, context) => {
          const current = slug?.current
          if (!current) return 'Required'
          if (!SLUG_REGEX.test(current)) {
            return 'Lowercase letters, numbers, and dashes only'
          }
          const hostRef = (context.document as { host?: { _ref?: string } } | undefined)?.host
            ?._ref
          if (!hostRef) return true
          const client = context.getClient({ apiVersion: '2026-04-27' })
          const id = context.document?._id?.replace(/^drafts\./, '')
          const count = await client.fetch<number>(
            `count(*[_type == "meetingType" && host._ref == $hostRef && slug.current == $slug && !(_id in [$id, "drafts." + $id])])`,
            { hostRef, slug: current, id: id ?? '' }
          )
          return count === 0 || 'You already have an event type with this slug'
        }),
    }),
    defineField({ name: 'description', type: 'text', rows: 4 }),
    defineField({
      name: 'duration',
      title: 'Duration (minutes)',
      type: 'number',
      initialValue: 30,
      validation: (rule) => rule.required().integer().min(1).max(480),
    }),
    defineField({
      name: 'location',
      type: 'location',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'color',
      type: 'string',
      options: { list: [...COLOR_OPTIONS], layout: 'radio' },
      initialValue: 'blue',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'active',
      type: 'boolean',
      initialValue: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'bufferBefore',
      title: 'Buffer before override (minutes)',
      type: 'number',
      validation: (rule) => rule.integer().min(0),
    }),
    defineField({
      name: 'bufferAfter',
      title: 'Buffer after override (minutes)',
      type: 'number',
      validation: (rule) => rule.integer().min(0),
    }),
    defineField({
      name: 'minimumNotice',
      title: 'Minimum notice override (minutes)',
      type: 'number',
      validation: (rule) => rule.integer().min(0),
    }),
    defineField({
      name: 'maxBookingsPerDay',
      type: 'number',
      validation: (rule) => rule.integer().min(1),
    }),
    defineField({
      name: 'bookingWindowDays',
      type: 'number',
      initialValue: 60,
      validation: (rule) => rule.required().integer().min(1).max(365),
    }),
    defineField({
      name: 'createdAt',
      type: 'datetime',
      readOnly: true,
      initialValue: () => new Date().toISOString(),
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: { title: 'title', duration: 'duration', hostName: 'host.displayName' },
    prepare: ({ title, duration, hostName }) => ({
      title: title ?? 'Untitled',
      subtitle: `${duration ?? 0} min · ${hostName ?? 'no host'}`,
    }),
  },
})
