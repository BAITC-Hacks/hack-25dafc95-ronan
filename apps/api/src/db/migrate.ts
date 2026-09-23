import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadLocalEnv } from '../local-env.js';

loadLocalEnv();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for migrations');
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const base = fileURLToPath(new URL('../../migrations/', import.meta.url));
    // 001 creates schema_migrations. Subsequent files are applied once in order.
    for (const version of ['001_catalog', '002_demo_cart']) {
      const found = version === '001_catalog' ? { rowCount: 0 } : await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
      if (found.rowCount) continue;
      const sql = await readFile(resolve(base, `${version}.sql`), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [version]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
} finally { await pool.end(); }
