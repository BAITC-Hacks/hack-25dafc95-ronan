import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { FixtureCatalogProvider } from './catalog/fixture.js';
import { EktCatalogProvider } from './catalog/ekt.js';
import { loadConfig } from './config.js';
import pg from 'pg';
import { PgDemoCartStore } from './cart/store.js';
import { MlCoreClient } from './ml/client.js';
import { loadLocalEnv } from './local-env.js';
import { createLlmProvider } from './llm/provider.js';

loadLocalEnv();
const config = loadConfig();
const catalog = config.CATALOG_MODE === 'fixture'
  ? new FixtureCatalogProvider(fileURLToPath(new URL('../../../samples/', import.meta.url)))
  : new EktCatalogProvider({
      user: config.EKT_API_USER!, password: config.EKT_API_PASSWORD!,
      timeoutMs: config.EKT_TIMEOUT_MS, maxConcurrent: config.EKT_MAX_CONCURRENT,
    });

const pool = config.DATABASE_URL ? new pg.Pool({ connectionString: config.DATABASE_URL }) : null;
const cart = pool ? new PgDemoCartStore(pool, catalog) : undefined;
const llm = createLlmProvider(config);
const app = await buildApp(config, catalog, {
  ...(cart ? { cart } : {}), ...(llm ? { llm } : {}), ml: new MlCoreClient(config.ML_CORE_URL),
});
if (pool) app.addHook('onClose', async () => { await pool.end(); });
await app.listen({ host: '0.0.0.0', port: config.PORT });
