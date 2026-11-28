import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: false,
  build: {
    minify: false,
    target: 'esnext'
  }
});
