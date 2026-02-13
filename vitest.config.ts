import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'resolve-js-to-ts',
      resolveId(source, importer) {
        if (source.endsWith('.js') && importer && !source.includes('node_modules')) {
          const tsPath = source.replace(/\.js$/, '.ts');
          return this.resolve(tsPath, importer, { skipSelf: true });
        }
        return null;
      },
    },
  ],
  test: {
    include: ['src/**/*.test.ts'],
    globals: true,
    pool: 'forks',
    server: {
      deps: {
        moduleDirectories: ['node_modules'],
      },
    },
  },
});
