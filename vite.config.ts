import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from a GitHub Pages sub-path.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
