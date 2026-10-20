import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative asset paths, so the built site works wherever it's served:
// a GitHub Pages project site (/<repository-name>/, whatever the name),
// a <user>.github.io root, or locally.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
})
