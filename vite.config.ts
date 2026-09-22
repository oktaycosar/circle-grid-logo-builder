import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Göreli yollar: derlenmiş `dist` klasörü hem sunucudan hem de doğrudan
  // diskten (file://, Electron/Tauri) açılabilsin.
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
    assetsDir: 'assets',
  },
  base: './',
});
