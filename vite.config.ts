import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? process.env.npm_package_version ?? 'dev'),
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
