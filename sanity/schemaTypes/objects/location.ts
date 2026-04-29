import { defineType, defineField } from 'sanity'

const LOCATION_TYPES = [
  { title: 'Zoom', value: 'zoom' },
  { title: 'Google Meet', value: 'googleMeet' },
  { title: 'Phone', value: 'phone' },
  { title: 'In-person', value: 'inPerson' },
  { title: 'Custom URL', value: 'customUrl' },
] as const

const VALUE_REQUIRED_TYPES = new Set(['phone', 'inPerson', 'customUrl'])

export const location = defineType({
  name: 'location',
  title: 'Location',
  type: 'object',
  fields: [
    defineField({
      name: 'type',
      type: 'string',
      options: { list: [...LOCATION_TYPES], layout: 'radio' },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'value',
      type: 'string',
      description:
        'Required for Phone (number), In-person (address), and Custom URL. Leave empty for Zoom and Google Meet — the URL is generated at booking time.',
      validation: (rule) =>
        rule.custom((value, context) => {
          const parent = context.parent as { type?: string } | undefined
          const type = parent?.type
          if (type && VALUE_REQUIRED_TYPES.has(type) && !value) {
            return 'Required for this location type'
          }
          return true
        }),
    }),
    defineField({
      name: 'instructions',
      type: 'text',
      rows: 3,
    }),
  ],
  preview: {
    select: { type: 'type', value: 'value' },
    prepare: ({ type, value }) => {
      const label = LOCATION_TYPES.find((t) => t.value === type)?.title ?? 'Unset'
      return { title: label, subtitle: value || undefined }
    },
  },
})
