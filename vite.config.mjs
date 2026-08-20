import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    watch: {
      ignored: ['**/release/**', '**/assets/runtime/**'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
