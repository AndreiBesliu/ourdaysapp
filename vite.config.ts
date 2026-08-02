import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // The game is a git SUBMODULE (its own repo, its own product) mounted at
    // src/warlord. The alias hides its internal layout, so if it ever becomes a
    // published package only this line changes — not every import site.
    alias: {
      '@warlord': fileURLToPath(new URL('./src/warlord/src', import.meta.url)),
    },
    // The submodule carries its own node_modules when developed standalone. Without
    // this, a bare `react` import inside the game resolves to ITS copy and the app
    // ends up with two Reacts — which surfaces as "Invalid hook call", not as a
    // module error.
    dedupe: ['react', 'react-dom'],
  },
})
