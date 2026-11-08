import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], build: { rollupOptions: { output: { manualChunks: { charts: ['recharts'], three: ['three'] } } } }, server: { host: '0.0.0.0', port: 5173, fs:{deny:['.env','.env.*','**/*.{key,crt,pem}','**/.git/**','**/.vercel/**','**/.cache/**','**/var/**']}, proxy: { '/api': 'http://127.0.0.1:3001', '/media': 'http://127.0.0.1:3001' } } });
