import { defineType, defineField, defineArrayMember } from 'sanity'
import { CalendarIcon } from '@sanity/icons'

export const googleCalendarConnectionType = defineType({
  name: 'googleCalendarConnectionType',
  title: 'Google Calendar connection',
  type: 'document',
  icon: CalendarIcon,
  fields: [
    defineField({
      name: 'user',
      type: 'reference',
      to: [{ type: 'userType' }],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'clerkId',
      type: 'string',
      description: "Mirror of the host's Clerk user ID. Read-only.",
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'googleEmail',
      type: 'string',
      description: 'The Google account that was authorized.',
      validation: (rule) => rule.required().email(),
    }),
    defineField({
      name: 'refreshTokenCipher',
      type: 'string',
      description: 'AES-256-GCM encrypted refresh token. Never plaintext.',
      readOnly: true,
      hidden: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'accessTokenCipher',
      type: 'string',
      description: 'AES-256-GCM encrypted access token. Never plaintext.',
      readOnly: true,
      hidden: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'accessTokenExpiresAt',
      type: 'datetime',
      description: 'When the cached access token expires.',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'scopes',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      description: 'Scopes Google actually granted (may be subset of requested).',
      validation: (rule) => rule.required().min(1),
    }),
    defineField({
      name: 'calendars',
      type: 'array',
      description: 'Cached calendar list from Google. Refreshed on demand.',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'calendarRef',
          fields: [
            defineField({ name: 'calendarId', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'summary', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'primary', type: 'boolean', initialValue: false }),
            defineField({
              name: 'conflictCheck',
              type: 'boolean',
              initialValue: true,
              description: 'Reserved for future use (slot generator spec).',
            }),
          ],
          preview: {
            select: { title: 'summary', primary: 'primary' },
            prepare: ({ title, primary }) => ({
              title: title ?? 'Unnamed calendar',
              subtitle: primary ? 'Primary' : undefined,
            }),
          },
        }),
      ],
    }),
    defineField({
      name: 'writeTargetCalendarId',
      type: 'string',
      description: 'Calendar where booking events will be written. Reserved for future spec.',
    }),
    defineField({
      name: 'connectedAt',
      type: 'datetime',
      readOnly: true,
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: { email: 'googleEmail', userName: 'user.displayName' },
    prepare: ({ email, userName }) => ({
      title: userName ? `${userName} → Google` : email ?? 'Google connection',
      subtitle: email,
    }),
  },
})
