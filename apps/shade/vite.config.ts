import path from 'path';
import react from '@vitejs/plugin-react';
import { globSync } from 'glob';
import { resolve } from 'path';
import svgr from 'vite-plugin-svgr';
import { defineConfig } from 'vitest/config';

// https://vitejs.dev/config/
export default (function viteConfig() {
  return defineConfig({
    logLevel: process.env.CI ? 'info' : 'warn',
    // Match `?react` SVG imports with a RegExp: svgr's default minimatch
    // pattern never matches Windows module IDs, which use backslash
    // separators, so the imports would survive into the lib output.
    plugins: [svgr({ include: /\.svg\?react$/ }), react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    },
    preview: {
      port: 4174,
    },
    build: {
      reportCompressedSize: false,
      minify: false,
      sourcemap: true,
      outDir: 'es',
      lib: {
        formats: ['es'],
        // Glob patterns must use forward slashes: with Windows backslash
        // separators globSync matches nothing, leaving Rolldown with no
        // entrypoint (`You must supply options.input`).
        entry: globSync(resolve(__dirname, 'src/**/*.{ts,tsx}').replace(/\\/g, '/')).reduce(
          (entries, libpath) => {
            if (libpath.includes('.stories.') || libpath.endsWith('.d.ts')) {
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

          if (normalizedSource.startsWith('@/')) {
            return false;
          }

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
      exclude: ['./test/unit/utils/test-utils.tsx'],
      testTimeout: process.env.TIMEOUT ? parseInt(process.env.TIMEOUT) : 10000,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        include: ['src/**/*.{js,jsx,ts,tsx}'],
        exclude: ['src/**/*.stories.{js,jsx,ts,tsx}', 'src/**/*.d.ts', 'src/types/**/*'],
      },
    },
  });
});
