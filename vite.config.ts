import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Teacher Student Notes',
        short_name: 'NotesPWA',
        description: 'A mobile-first notes workspace for teachers',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }]
      }
    })
  ]
});
