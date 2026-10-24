import { fileURLToPath } from 'node:url';
import { TIME_ZONE } from '@habait/shared';
import { buildApp } from './app.js';
import { createDb, migrateDb } from './db/connection.js';
import { seedDatabase } from './db/seed.js';
import { startScheduler } from './scheduler.js';
import { getSessionSecret } from './services/user.service.js';

process.env['TZ'] = TIME_ZONE;

const PORT = Number(process.env['PORT'] ?? 3000);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const WEB_DIST_PATH = fileURLToPath(new URL('../../web/dist', import.meta.url));

async function main() {
  getSessionSecret(); // crash at boot, not on first login, if SESSION_SECRET is missing in production
  const handle = createDb();
  migrateDb(handle);
  seedDatabase(handle.db);
  const scheduler = startScheduler(handle.db);

  const app = await buildApp({
    db: handle.db,
    webDistPath: WEB_DIST_PATH,
  });

  const shutdown = async () => {
    scheduler.stop();
    await app.close();
    handle.sqlite.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: PORT, host: HOST });
  console.log(`habait server listening on http://${HOST}:${PORT} (TZ=${TIME_ZONE})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
