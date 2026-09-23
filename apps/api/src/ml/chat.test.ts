import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { FixtureCatalogProvider } from '../catalog/fixture.js';
import { loadConfig } from '../config.js';
import { fallbackQuery, MlCoreClient } from './client.js';

const fixture = new FixtureCatalogProvider(fileURLToPath(new URL('../../../../samples/', import.meta.url)));
const config = loadConfig({ CATALOG_MODE: 'fixture', CART_MODE: 'demo', AI_MODE: 'stub' });

describe('chat and ml_core boundary', () => {
  it('preserves exact articles and does not extract a brand as an identifier', () => {
    for (const article of ['027228', '200300285_', 'DEMO_001']) expect(fallbackQuery(`Найди ${article}`)).toBe(article);
    expect(fallbackQuery('Нужен автомат Legrand на 160 А')).toBe('Нужен автомат Legrand на 160 А');
  });

  it.each(['unavailable', 'misleading'] as const)('enforces catalog type/current with %s Python', async (mode) => {
    const fetcher = vi.fn(async () => {
      if (mode === 'unavailable') throw new Error('offline');
      return Response.json({ query: 'Legrand', ranked_ids: [515277, 515284, 515291, 515288] });
    });
    const app = await buildApp(config, fixture, { ml: new MlCoreClient('http://127.0.0.1:9999', fetcher) });
    try {
      for (const message of ['Нужен автомат Legrand на 160 А', 'автомат 160А 18kA', 'автомат160А', 'автомат на 250 А']) {
        const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { message } });
        expect(response.statusCode).toBe(200);
        expect(response.json().products).toEqual([]);
        expect(response.json().answer).toContain('нет подтверждённых совпадений');
        const search = await app.inject({ method: 'GET', url: `/api/products?q=${encodeURIComponent(message)}` });
        expect(search.json().items).toEqual([]);
      }
      const sixteen = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Нужен автомат на 16 А' } });
      expect(sixteen.json().products.map((product: { id: number }) => product.id)).toEqual([900000001]);
      for (const article of ['027228', '200300285_']) {
        const exact = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: `Найди ${article}` } });
        expect(exact.json().products).toHaveLength(1);
        expect(exact.json().products[0].id).toBe(515291);
        expect(exact.json().products[0].warnings[0].code).toBe('SPEC_CONFLICT');
      }
      const demo = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'Найди DEMO_001' } });
      expect(demo.json().products[0].article).toBe('DEMO_001');
      const mixedArticle = await app.inject({ method: 'GET', url: '/api/products?q=RM22UA33MR' });
      expect(mixedArticle.json().items[0].match).toBe('exact_identifier');
      expect(mixedArticle.json().items[0].product.article).toBe('RM22UA33MR');
    } finally { await app.close(); }
  });

  it('finds a verified catalog card when Python is unavailable', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline'); });
    const app = await buildApp(config, fixture, { ml: new MlCoreClient('http://127.0.0.1:9999', fetcher) });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/chat',
        payload: { message: 'Есть 027228 в Астане?', locale: 'ru' } });
      expect(response.statusCode).toBe(200);
      expect(response.json().ml_status).toBe('unavailable');
      expect(response.json().products[0].id).toBe(515291);
      expect(response.json().products[0].stock.reported_store_quantity).toBe('8');
      const search = await app.inject({ method: 'GET', url: '/api/products?q=027228' });
      expect(search.json().items[0].product.id).toBe(515291);
    } finally { await app.close(); }
  });

  it('rejects unknown ranked IDs from Python', async () => {
    const fetcher = vi.fn(async () => Response.json({ query: '027228', ranked_ids: [123456789] }));
    const app = await buildApp(config, fixture, { ml: new MlCoreClient('http://127.0.0.1:9999', fetcher) });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/chat', payload: { message: '027228' } });
      expect(response.json().ml_status).toBe('unavailable');
      expect(response.json().products[0].id).toBe(515291);
    } finally { await app.close(); }
  });
});
