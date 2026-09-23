import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { EktCatalogProvider } from './ekt.js';
import { FixtureCatalogProvider } from './fixture.js';

const fixture = new FixtureCatalogProvider(resolve(process.cwd(), '../../samples'));
const config = loadConfig({ CATALOG_MODE: 'fixture', CART_MODE: 'demo', AI_MODE: 'stub' });

describe('fixture catalog', () => {
  it('keeps exact identifiers, stock provenance and specification conflict', async () => {
    const app = await buildApp(config, fixture);
    try {
      for (const q of ['515291', '200300285_', '027228']) {
        const search = await app.inject({ method: 'GET', url: `/api/products?q=${encodeURIComponent(q)}` });
        expect(search.statusCode).toBe(200);
        expect(search.json().items[0].product.id).toBe(515291);
        expect(search.json().items[0].match).toBe('exact_identifier');
        expect(search.json().coverage.complete).toBe(false);
      }
      const response = await app.inject({ method: 'GET', url: '/api/products/515291' });
      expect(response.statusCode).toBe(200);
      const product = response.json();
      expect(product.article).toBe('200300285_');
      expect(product.supplier_article).toBe('027228');
      expect(product.stock.reported_total).toBe('23');
      expect(product.stock.reported_store_quantity).toBe('8');
      expect(product.stock.sellable_quantity).toBeNull();
      expect(product.warnings[0].code).toBe('SPEC_CONFLICT');
      expect(product.provenance.fetched_at).toBeNull();
      expect(product.provenance.catalog_complete).toBe(false);
      const openapi = await app.inject({ method: 'GET', url: '/api/openapi.json' });
      expect(openapi.statusCode).toBe(200);
      expect(openapi.json().paths['/api/products/{id}']).toBeDefined();
    } finally { await app.close(); }
  }, 15000);

  it('does not infer zero stock from list items or catalog size from count', async () => {
    const app = await buildApp(config, fixture);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/products/515288' });
      expect(response.statusCode).toBe(200);
      expect(response.json().stock.reported_total).toBeNull();
      expect(response.json().detail_available).toBe(false);
      const search = await app.inject({ method: 'GET', url: '/api/products?q=nomatch' });
      expect(search.json().coverage.reported_count).toBe(20);
      expect(search.json().coverage.complete).toBe(false);
    } finally { await app.close(); }
  });

  it('lists inspected products for the frontend without claiming full coverage', async () => {
    const app = await buildApp(config, fixture);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/products' });
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toHaveLength(21);
      expect(response.json().items.find((entry: { product: { id: number } }) => entry.product.id === 900000001).product.provenance.source).toBe('synthetic');
      expect(response.json().coverage.complete).toBe(false);
    } finally { await app.close(); }
  });

  it('returns structured errors for invalid input and uncovered products', async () => {
    const app = await buildApp(config, fixture);
    try {
      const bad = await app.inject({ method: 'GET', url: '/api/products?q=' });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe('VALIDATION_ERROR');
      const missing = await app.inject({ method: 'GET', url: '/api/products/999999999' });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe('PRODUCT_NOT_IN_COVERAGE');
    } finally { await app.close(); }
  });
});

describe('live provider', () => {
  it('does not retry authentication errors or follow redirects', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 401 }));
    const provider = new EktCatalogProvider({ user: 'test', password: 'test', timeoutMs: 1000, maxConcurrent: 2, fetcher });
    await expect(provider.getProduct(515291)).rejects.toMatchObject({ code: 'UPSTREAM_AUTH_FAILED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.length).toBe(1);
  });

  it('retries a temporary error and uses only documented page parameter', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ page: 2, per_page: 20, count: 20, items: [] }));
    const provider = new EktCatalogProvider({ user: 'test', password: 'test', timeoutMs: 1500, maxConcurrent: 2, fetcher });
    const page = await provider.getPage(2);
    expect(page.reportedCount).toBe(20);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://ekt.kz/api/products?page=2');
  });

  it('deduplicates concurrent reads and retries 429 within deadline', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(Response.json({ id: 515291, name: 'fixture', article: '000_', price: 1 }));
    const provider = new EktCatalogProvider({ user: 'test', password: 'test', timeoutMs: 1500, maxConcurrent: 1, fetcher });
    const [first, second] = await Promise.all([provider.getProduct(515291), provider.getProduct(515291)]);
    expect(first?.raw.article).toBe('000_');
    expect(second?.raw.article).toBe('000_');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
