export type Source = 'user_snapshot' | 'ekt_live' | 'synthetic';
export type RawProduct = Record<string, unknown>;

export interface CatalogPage {
  page: number;
  perPage: number;
  reportedCount: number | null;
  items: RawProduct[];
  source: Source;
  fetchedAt: string | null;
}

export interface CatalogRecord {
  raw: RawProduct;
  source: Source;
  fetchedAt: string | null;
  detailAvailable: boolean;
}

export interface CatalogProvider {
  getPage(page: number): Promise<CatalogPage>;
  getProduct(id: number): Promise<CatalogRecord | null>;
  listExtras?(): Promise<CatalogRecord[]>;
}
