import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths so the same build works on localhost and on GitHub Pages (/SubManager/).
  base: './',
  plugins: [react()],
  // The port is fixed because it is registered as an authorized JavaScript origin in Google Cloud.
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
