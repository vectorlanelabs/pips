import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/pips/',
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    // Agent worktrees under .claude/worktrees are checkouts of this repo — without
    // this exclude, vitest collects THEIR test files into the main suite too.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
})
