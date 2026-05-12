import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Server-only modules use 'server-only' which we don't want to import in tests.
    server: { deps: { inline: [] } },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Stub Next.js's `server-only` package so pure-function tests can import
      // server-only modules. (Tests still must not call DB/cookies code paths.)
      'server-only': fileURLToPath(new URL('./vitest.setup.ts', import.meta.url)),
    },
  },
})
