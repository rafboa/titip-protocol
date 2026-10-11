import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@titip/db': path.resolve(__dirname, '../../packages/db/src'),
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    exclude: ['node_modules', '.next'],
  },
})
