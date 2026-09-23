import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { FixtureCatalogProvider } from '../catalog/fixture.js';
import { normalizeProduct } from '../catalog/normalize.js';
import type { CatalogRecord } from '../catalog/types.js';
import { loadLocalEnv } from '../local-env.js';

loadLocalEnv();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required to seed fixtures');
if (process.env.NODE_ENV === 'production') throw new Error('Fixture seed is disabled in production');

const provider = new FixtureCatalogProvider(fileURLToPath(new URL('../../../../samples/', import.meta.url)));
const page = await provider.getPage(2);
const detail = await provider.getProduct(515291);
if (!detail) throw new Error('Fixture detail 515291 is missing');
const pool = new pg.Pool({ connectionString: databaseUrl });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const records: CatalogRecord[] = page.items.map((raw) => ({
    raw, source: page.source, fetchedAt: null, detailAvailable: false,
  }));
  records.push(detail);
  for (const record of records) {
    const product = normalizeProduct(record, 'demo');
    await client.query(`INSERT INTO catalog_products
      (upstream_id, source, raw_json, article, supplier_article, barcode, name, price_amount, reported_quantity, detail_available, fetched_at)
      VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8::numeric,$9::numeric,$10,$11)
      ON CONFLICT (upstream_id) DO UPDATE SET
      source = EXCLUDED.source, raw_json = EXCLUDED.raw_json, article = EXCLUDED.article,
      supplier_article = EXCLUDED.supplier_article, barcode = EXCLUDED.barcode,
      name = EXCLUDED.name, price_amount = EXCLUDED.price_amount,
      reported_quantity = EXCLUDED.reported_quantity, detail_available = EXCLUDED.detail_available,
      fetched_at = EXCLUDED.fetched_at, updated_at = now()`, [
      product.id, record.source, JSON.stringify(record.raw), product.article,
      product.supplier_article, product.barcode, product.name, product.price.amount,
      product.stock.reported_total, record.detailAvailable, record.fetchedAt,
    ]);
  }
  await client.query(`INSERT INTO catalog_sync_runs
    (source, finished_at, pages_inspected, details_inspected, items_seen, complete, stop_reason)
    VALUES ($1, now(), 1, 1, $2, false, 'provided_snapshot_only')`, [page.source, page.items.length]);
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
