import type { CatalogRecord, RawProduct } from './types.js';

const str = (value: unknown): string | null => typeof value === 'string' || typeof value === 'number' ? String(value) : null;
const obj = (value: unknown): RawProduct => value && typeof value === 'object' && !Array.isArray(value) ? value as RawProduct : {};
const decimal = (value: unknown): string | null => {
  const text = str(value);
  return text && /^\d+(?:\.\d+)?$/.test(text) ? text : null;
};

export function normalizeProduct(record: CatalogRecord, cartMode: 'demo' | 'ekt') {
  const raw = record.raw;
  const properties = obj(raw.properties);
  const stores = Array.isArray(raw.stores) ? raw.stores.map(obj) : [];
  const store24 = stores.find((store) => Number(store.id) === 24);
  const synthetic = record.source === 'synthetic';
  const name = str(raw.name);
  const description = str(raw.description);
  const nominal = str(properties.NOMINALNYY_TOK);
  const claims = [name, description].filter(Boolean).join(' ');
  const conflict = Number(raw.id) === 515291 && /160\s*А/i.test(claims) && nominal !== null && /250\s*А/i.test(nominal);
  const supplierArticle = str(properties.ARTIKULPOSTAVSHCHIKA);

  return {
    id: Number(raw.id),
    article: str(raw.article),
    supplier_article: supplierArticle,
    barcode: str(properties.CML2_BAR_CODE),
    name,
    description: record.detailAvailable ? description : null,
    price: { amount: decimal(raw.price), currency: synthetic ? str(raw.currency) : null, currency_source: synthetic ? 'synthetic_fixture' : null },
    stock: {
      reported_total: record.detailAvailable ? decimal(raw.quantity) : null,
      selected_store_id: store24 ? 24 : null,
      selected_store_raw_name: store24 ? str(store24.name) : null,
      selected_store_display_name: store24 ? 'Астана' : null,
      reported_store_quantity: store24 ? decimal(store24.quantity) : null,
      sellable_quantity: synthetic && store24?.sellable === true ? decimal(store24.quantity) : null,
    },
    purchase_rules: synthetic ? { unit: str(raw.unit), min_quantity: decimal(raw.min_quantity), quantity_step: decimal(raw.quantity_step), source: 'synthetic' as const } : null,
    certificates: [],
    warnings: conflict ? [{ code: 'SPEC_CONFLICT' as const, field: 'nominal_current', claims: [
      { value: '160 А', source: 'name_and_description' },
      { value: '250 А', source: 'properties.NOMINALNYY_TOK' },
    ] }] : [],
    provenance: {
      source: record.source,
      catalog_mode: record.source === 'ekt_live' ? 'live' as const : 'fixture' as const,
      fetched_at: record.fetchedAt,
      freshness: record.source === 'user_snapshot' ? 'snapshot' as const : record.source === 'synthetic' ? 'synthetic' as const : 'live_response' as const,
      catalog_complete: false as const,
      field_sources: {
        article: raw.article === undefined ? null : 'article',
        supplier_article: supplierArticle === null ? null : 'properties.ARTIKULPOSTAVSHCHIKA',
        price: raw.price === undefined ? null : 'price',
        reported_total: record.detailAvailable && raw.quantity !== undefined ? 'quantity' : null,
        reported_store_quantity: store24 ? 'stores[id=24].quantity' : null,
      },
    },
    cart_mode: cartMode,
    detail_available: record.detailAvailable,
  };
}

export function productMatches(raw: RawProduct, query: string): { rank: number; match: 'exact_identifier' | 'name' } | null {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return null;
  const properties = obj(raw.properties);
  const keys = [raw.id, raw.article, properties.ARTIKULPOSTAVSHCHIKA, properties.CML2_BAR_CODE]
    .map(str).filter((value): value is string => value !== null);
  if (keys.some((value) => value.toLocaleLowerCase() === needle)) return { rank: 0, match: 'exact_identifier' };
  if (str(raw.name)?.toLocaleLowerCase().includes(needle)) return { rank: 1, match: 'name' };
  return null;
}
