import { defineConfig } from 'vite';

export default defineConfig({
  // Serve from project root
  root: '.',
  build: {
    // Output to dist/
    outDir: 'dist',
    // Source maps for debugging
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: false,
  },
});
