import dts from 'vite-plugin-dts';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: './src/index.ts', // Specifies the entry point for building the library.
      name: 'kg-unsplash-selector', // Sets the name of the generated library.
      fileName: (format) => `index.${format}.js`, // Generates the output file name based on the format.
      formats: ['cjs', 'es'], // Specifies the output formats (CommonJS and ES modules).
    },
    rolldownOptions: {
      external: [/^react($|\/)/, /^react-dom($|\/)/], // Defines external dependencies for Rolldown bundling.
    },
    sourcemap: true, // Generates source maps for debugging.
    emptyOutDir: true, // Clears the output directory before building.
  },
  // Match `?react` SVG imports with a RegExp: svgr's default minimatch
  // pattern never matches Windows module IDs, which use backslash
  // separators, so the imports would survive into the lib output.
  plugins: [svgr({ include: /\.svg\?react$/ }), react(), dts()], // Uses the 'vite-plugin-dts' plugin for generating TypeScript declaration files (d.ts).
});
