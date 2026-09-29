import path from 'path';
import react from '@vitejs/plugin-react';
import { globSync } from 'glob';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

// https://vitejs.dev/config/
export default (function viteConfig() {
  return defineConfig({
    logLevel: process.env.CI ? 'info' : 'warn',
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    preview: {
      port: 4174,
    },
    build: {
      reportCompressedSize: false,
      minify: false,
      sourcemap: true,
      outDir: 'dist',
      lib: {
        formats: ['es', 'cjs'],
        // Glob patterns must use forward slashes: with Windows backslash
        // separators globSync matches nothing, leaving Rolldown with no
        // entrypoint (`You must supply options.input`).
        entry: globSync(resolve(__dirname, 'src/**/*.{ts,tsx}').replace(/\\/g, '/')).reduce(
          (entries, libpath) => {
            if (libpath.endsWith('.d.ts')) {
              return entries;
            }

            const outPath = libpath
              .replace(/\\/g, '/')
              .replace(resolve(__dirname, 'src').replace(/\\/g, '/') + '/', '')
              .replace(/\.(ts|tsx)$/, '');
            entries[outPath] = libpath;
            return entries;
          },
          {} as Record<string, string>,
        ),
      },
      commonjsOptions: {
        include: [/packages/, /node_modules/],
      },
      rollupOptions: {
        external: (source) => {
          // Rolldown passes resolved module IDs with forward slashes even
          // on Windows, so normalize before comparing against __dirname —
          // otherwise every in-repo import is treated as external and left
          // raw in the lib output.
          const normalizedSource = source.replace(/\\/g, '/');
          const normalizedDir = __dirname.replace(/\\/g, '/');

          if (normalizedSource.startsWith('.')) {
            return false;
          }

          if (normalizedSource.includes('node_modules')) {
            return true;
          }

          return !normalizedSource.includes(normalizedDir);
        },
      },
    },
    test: {
      globals: true, // required for @testing-library/jest-dom extensions
      environment: 'jsdom',
      include: ['./test/unit/**/*'],
      setupFiles: ['./test/setup.ts'],
      testTimeout: process.env.TIMEOUT ? parseInt(process.env.TIMEOUT) : 10000,
    },
  });
});
