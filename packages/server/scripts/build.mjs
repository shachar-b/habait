import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts', 'src/db/seed.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [
    'better-sqlite3',
    'fastify',
    '@fastify/cookie',
    '@fastify/static',
    'fastify-type-provider-zod',
    'drizzle-orm',
    'drizzle-orm/*',
    'croner',
    'zod',
  ],
});
