import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CatalogError } from './errors.js';
import type { CatalogPage, CatalogProvider, CatalogRecord, RawProduct } from './types.js';

export class FixtureCatalogProvider implements CatalogProvider {
  constructor(private readonly directory: string) {}

  private async read(name: string): Promise<RawProduct> {
    try {
      const value: unknown = JSON.parse(await readFile(join(this.directory, name), 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid fixture object');
      return value as RawProduct;
    } catch {
      throw new CatalogError('FIXTURE_MISSING', `Fixture ${name} is missing or invalid`, 503, false);
    }
  }

  async getPage(page: number): Promise<CatalogPage> {
    // Only supplied snapshots can be served. A missing page is not an empty catalog page.
    const raw = await this.read(`ekt-products-page${page}.json`);
    if (!Array.isArray(raw.items)) throw new CatalogError('UPSTREAM_BAD_RESPONSE', 'Fixture page has no items', 503, false);
    return {
      page: typeof raw.page === 'number' ? raw.page : page,
      perPage: typeof raw.per_page === 'number' ? raw.per_page : raw.items.length,
      reportedCount: typeof raw.count === 'number' ? raw.count : null,
      items: raw.items as RawProduct[],
      source: 'user_snapshot', fetchedAt: null,
    };
  }

  async getProduct(id: number): Promise<CatalogRecord | null> {
    const demo = (await this.listExtras()).find((record) => record.raw.id === id);
    if (demo) return demo;
    if (id === 515291) {
      const raw = await this.read('ekt-product-515291.json');
      return { raw, source: 'user_snapshot', fetchedAt: null, detailAvailable: true };
    }
    const page = await this.getPage(2);
    const raw = page.items.find((item) => item.id === id);
    return raw ? { raw, source: 'user_snapshot', fetchedAt: null, detailAvailable: false } : null;
  }

  async listExtras(): Promise<CatalogRecord[]> {
    const raw = await this.read(join('synthetic', 'demo-products.json'));
    if (!Array.isArray(raw.products)) throw new CatalogError('FIXTURE_MISSING', 'Synthetic demo products are missing', 503, false);
    return raw.products.map((product) => ({ raw: product as RawProduct, source: 'synthetic' as const, fetchedAt: null, detailAvailable: true }));
  }
}
