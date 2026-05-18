import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: { port: 5174, open: true },
  resolve: {
    alias: {
      '@dataset': resolve(__dirname, 'dataset.json'),
    },
  },
});
