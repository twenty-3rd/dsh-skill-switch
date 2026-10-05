import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Stub CSS imports: the node test environment has no CSS loader, and the
  // client half imports a CSS module (its class map is irrelevant to tests).
  plugins: [
    {
      name: 'stub-css',
      enforce: 'pre',
      resolveId(id: string) {
        if (id.endsWith('.css')) return id
      },
      load(id: string) {
        if (id.endsWith('.css')) return 'export default {}'
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
