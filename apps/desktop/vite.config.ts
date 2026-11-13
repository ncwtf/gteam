import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  
  optimizeDeps: {
    include: ['@gteam/shared']
  },

  build: {
    commonjsOptions: {
      include: [/@gteam\/shared/, /node_modules/],
      transformMixedEsModules: true
    }
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  }
});
