import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['@novnc/novnc/lib/rfb.js'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws/desktop': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/ws/terminal': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/ws': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
});
