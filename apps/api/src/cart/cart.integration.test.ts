import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { FixtureCatalogProvider } from '../catalog/fixture.js';
import { loadConfig } from '../config.js';
import { PgDemoCartStore } from './store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const fixture = new FixtureCatalogProvider(fileURLToPath(new URL('../../../../samples/', import.meta.url)));
const config = loadConfig({ CATALOG_MODE: 'fixture', CART_MODE: 'demo', AI_MODE: 'stub' });
const origin = 'http://localhost:8000';

describe.skipIf(!databaseUrl)('demo cart with PostgreSQL', () => {
  it('requires a separate confirm, deduplicates concurrent confirms and rejects another session', async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const app = await buildApp(config, fixture, { cart: new PgDemoCartStore(pool, fixture) });
    try {
      const session = await app.inject({ method: 'POST', url: '/api/session', headers: { origin, host: 'localhost:8000' } });
      expect(session.statusCode).toBe(200);
      const cookie = session.headers['set-cookie'] as string;
      const csrf = session.json().csrf_token as string;
      const headers = { origin, host: 'localhost:8000', cookie, 'x-csrf-token': csrf };

      const noCsrf = await app.inject({ method: 'POST', url: '/api/cart/proposals',
        headers: { origin, host: 'localhost:8000', cookie },
        payload: { items: [{ product_id: 900000001, store_id: 24, quantity: '1' }] } });
      expect(noCsrf.statusCode).toBe(403);
      const wrongOrigin = await app.inject({ method: 'POST', url: '/api/cart/proposals',
        headers: { ...headers, origin: 'https://unrelated.example' },
        payload: { items: [{ product_id: 900000001, store_id: 24, quantity: '1' }] } });
      expect(wrongOrigin.statusCode).toBe(403);

      const proposal = await app.inject({ method: 'POST', url: '/api/cart/proposals', headers,
        payload: { items: [{ product_id: 900000001, store_id: 24, quantity: '2' }] } });
      expect(proposal.statusCode).toBe(200);
      const proposalId = proposal.json().proposal_id as string;
      const before = await app.inject({ method: 'GET', url: '/api/cart', headers: { cookie } });
      expect(before.json().items).toEqual([]);

      const otherSession = await app.inject({ method: 'POST', url: '/api/session', headers: { origin, host: 'localhost:8000' } });
      const foreign = await app.inject({ method: 'POST', url: `/api/cart/proposals/${proposalId}/confirm`,
        headers: { origin, host: 'localhost:8000', cookie: otherSession.headers['set-cookie'] as string,
          'x-csrf-token': otherSession.json().csrf_token as string, 'idempotency-key': 'foreign-action-1' },
        payload: { proposal_version: 1 } });
      expect(foreign.statusCode).toBe(404);

      const confirm = () => app.inject({ method: 'POST', url: `/api/cart/proposals/${proposalId}/confirm`,
        headers: { ...headers, 'idempotency-key': 'same-action-123' }, payload: { proposal_version: 1 } });
      const [first, second] = await Promise.all([confirm(), confirm()]);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(first.json()).toEqual(second.json());
      const after = await app.inject({ method: 'GET', url: '/api/cart', headers: { cookie } });
      expect(after.json().items[0].quantity).toBe('2');
      expect(after.json().version).toBe(1);
      const page = await app.inject({ method: 'GET', url: '/cart', headers: { cookie } });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('Демо-корзина');

      const newKey = await app.inject({ method: 'POST', url: `/api/cart/proposals/${proposalId}/confirm`,
        headers: { ...headers, 'idempotency-key': 'another-action-123' }, payload: { proposal_version: 1 } });
      expect(newKey.statusCode).toBe(409);
      const changedBody = await app.inject({ method: 'POST', url: `/api/cart/proposals/${proposalId}/confirm`,
        headers: { ...headers, 'idempotency-key': 'same-action-123' }, payload: { proposal_version: 2 } });
      expect(changedBody.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    } finally { await app.close(); await pool.end(); }
  });

  it('counts existing cart quantity and rejects EKT snapshot purchase rules', async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const app = await buildApp(config, fixture, { cart: new PgDemoCartStore(pool, fixture) });
    try {
      const session = await app.inject({ method: 'POST', url: '/api/session', headers: { origin, host: 'localhost:8000' } });
      const cookie = session.headers['set-cookie'] as string;
      const headers = { origin, host: 'localhost:8000', cookie, 'x-csrf-token': session.json().csrf_token as string };
      const real = await app.inject({ method: 'POST', url: '/api/cart/proposals', headers,
        payload: { items: [{ product_id: 515291, store_id: 24, quantity: '1' }] } });
      expect(real.json().error.code).toBe('PURCHASE_RULES_UNKNOWN');
      const six = await app.inject({ method: 'POST', url: '/api/cart/proposals', headers,
        payload: { items: [{ product_id: 900000001, store_id: 24, quantity: '6' }] } });
      const added = await app.inject({ method: 'POST', url: `/api/cart/proposals/${six.json().proposal_id}/confirm`,
        headers: { ...headers, 'idempotency-key': 'first-six-123' }, payload: { proposal_version: 1 } });
      expect(added.statusCode).toBe(200);
      const three = await app.inject({ method: 'POST', url: '/api/cart/proposals', headers,
        payload: { items: [{ product_id: 900000001, store_id: 24, quantity: '3' }] } });
      expect(three.statusCode).toBe(200);
      const refused = await app.inject({ method: 'POST', url: `/api/cart/proposals/${three.json().proposal_id}/confirm`,
        headers: { ...headers, 'idempotency-key': 'next-three-123' }, payload: { proposal_version: 1 } });
      expect(refused.json().error.code).toBe('INSUFFICIENT_STOCK');
      const cart = await app.inject({ method: 'GET', url: '/api/cart', headers: { cookie } });
      expect(cart.json().items[0].quantity).toBe('6');
    } finally { await app.close(); await pool.end(); }
  });
});
