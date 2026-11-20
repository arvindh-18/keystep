/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the same build loads from Electron's app:// protocol,
// Capacitor's WebView and a static web host.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'chrome100',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
