import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pre-bundle everything up front so a lazily imported module (three.js hero)
  // never triggers a mid-session re-optimization that duplicates React.
  optimizeDeps: {
    include: ['react', 'react-dom/client', 'gsap', '@gsap/react', 'three', 'roughjs', 'perfect-freehand', '@supabase/supabase-js'],
  },
})
