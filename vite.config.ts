import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 başka bir yerel proje tarafından kullanılabiliyor; çakışmayı
    // önlemek için sabit ve ayrı bir port kullanılır.
    port: 5180,
    strictPort: true,
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
