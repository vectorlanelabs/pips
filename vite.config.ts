import { execSync } from 'node:child_process'
import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The commit being built, shown in the Landing footer so a finished deploy is
// visually checkable against `git log` -- 'dev' if git isn't available.
const buildCommit = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
})()

// https://vite.dev/config/
export default defineConfig({
  base: '/pips/',
  plugins: [react()],
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    // Agent worktrees under .claude/worktrees are checkouts of this repo — without
    // this exclude, vitest collects THEIR test files into the main suite too.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
})
