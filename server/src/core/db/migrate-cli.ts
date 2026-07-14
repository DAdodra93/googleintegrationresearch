import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { PgStore } from '../store/pg.js';

const config = loadConfig();
if (!config.databaseUrl) {
  console.error('DATABASE_URL is not set — nothing to migrate');
  process.exit(1);
}
const store = new PgStore(config.databaseUrl);
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');
const applied = await store.migrate(dir);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
await store.close();
