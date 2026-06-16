import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In a production build, base matches the GitHub Pages project path so assets
// resolve under https://<user>.github.io/groundlink-flightviz/. Dev stays at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/groundlink-flightviz/' : '/',
  plugins: [react()],
  server: { port: 5173, open: true },
}))
