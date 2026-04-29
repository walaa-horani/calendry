import { defineType, defineField } from 'sanity'
import { UserIcon } from '@sanity/icons'

const USERNAME_REGEX = /^[a-z0-9-]{3,30}$/

function slugifyUsername(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 30)
}

export const userType = defineType({
  name: 'userType',
  title: 'Host',
  type: 'document',
  icon: UserIcon,
  fields: [
    defineField({
      name: 'clerkId',
      type: 'string',
      description: 'Clerk user ID. Managed by webhook; do not edit.',
      readOnly: true,
      hidden: true,
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'username',
      type: 'slug',
      description: 'Drives the public booking URL: /{username}',
      options: {
        source: 'displayName',
        maxLength: 30,
        slugify: slugifyUsername,
      },
      validation: (rule) =>
        rule.required().custom(async (slug, context) => {
          const current = slug?.current
          if (!current) return 'Required'
          if (!USERNAME_REGEX.test(current)) {
            return 'Must be 3–30 chars: lowercase letters, numbers, dashes only'
          }
          const client = context.getClient({ apiVersion: '2026-04-27' })
          const id = context.document?._id?.replace(/^drafts\./, '')
          const count = await client.fetch<number>(
            `count(*[_type == "userType" && username.current == $slug && !(_id in [$id, "drafts." + $id])])`,
            { slug: current, id: id ?? '' }
          )
          return count === 0 || 'Username is already taken'
        }),
    }),
    defineField({
      name: 'displayName',
      type: 'string',
      description: 'Mirrored from Clerk; editable here for admin overrides.',
      validation: (rule) => rule.required().min(1).max(100),
    }),
    defineField({
      name: 'email',
      type: 'string',
      description: 'Mirrored from Clerk. Read-only.',
      readOnly: true,
      validation: (rule) => rule.required().email(),
    }),
    defineField({
      name: 'avatarUrl',
      type: 'url',
      description: 'Mirrored from Clerk profile image. Read-only.',
      readOnly: true,
    }),
    defineField({
      name: 'timezone',
      type: 'string',
      description: 'IANA timezone, e.g. America/Los_Angeles.',
      initialValue: 'UTC',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'bio',
      type: 'text',
      rows: 4,
    }),
    defineField({
      name: 'welcomeMessage',
      type: 'string',
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
    select: { title: 'displayName', subtitle: 'username.current' },
    prepare: ({ title, subtitle }) => ({
      title: title ?? 'Unnamed host',
      subtitle: subtitle ? `@${subtitle}` : undefined,
    }),
  },
})
