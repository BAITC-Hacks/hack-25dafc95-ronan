import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { FixtureCatalogProvider } from '../catalog/fixture.js';
import { loadConfig } from '../config.js';

const fixture = new FixtureCatalogProvider(fileURLToPath(new URL('../../../../samples/', import.meta.url)));

describe('cart modes', () => {
  it('does not claim EKT cart integration is available', async () => {
    const app = await buildApp(loadConfig({ CATALOG_MODE: 'fixture', CART_MODE: 'ekt', AI_MODE: 'stub' }), fixture);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/cart' });
      expect(response.statusCode).toBe(501);
      expect(response.json().error.code).toBe('INTEGRATION_NOT_CONFIGURED');
    } finally { await app.close(); }
  });
});
