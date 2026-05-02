import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, 'test/stubs/server-only.ts'),
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
  },
})
