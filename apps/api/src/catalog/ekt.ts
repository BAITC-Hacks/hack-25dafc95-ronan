import { CatalogError } from './errors.js';
import type { CatalogPage, CatalogProvider, CatalogRecord, RawProduct } from './types.js';

export interface EktOptions {
  user: string;
  password: string;
  timeoutMs: number;
  maxConcurrent: number;
  fetcher?: typeof fetch;
}

export class EktCatalogProvider implements CatalogProvider {
  private readonly fetcher: typeof fetch;
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private readonly pending = new Map<string, Promise<RawProduct | null>>();

  constructor(private readonly options: EktOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  private async withSlot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.options.maxConcurrent) await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active++;
    try { return await work(); }
    finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }

  private async request(path: '/api/products' | '/api/products/detail', params: URLSearchParams): Promise<RawProduct | null> {
    const url = new URL(path, 'https://ekt.kz');
    url.search = params.toString();
    const key = url.href;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const job = this.withSlot(async () => {
      const deadline = Date.now() + this.options.timeoutMs;
      for (let attempt = 0; attempt < 3; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        let response: Response;
        try {
          response = await this.fetcher(url, {
            method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(remaining),
            headers: { Authorization: `Basic ${Buffer.from(`${this.options.user}:${this.options.password}`).toString('base64')}`, Accept: 'application/json' },
          });
        } catch {
          if (attempt === 2) break;
          continue;
        }
        if (response.status === 404) return null;
        if (response.status === 401 || response.status === 403) throw new CatalogError('UPSTREAM_AUTH_FAILED', 'EKT authentication failed', 502, false);
        if (response.status >= 300 && response.status < 400) throw new CatalogError('UPSTREAM_BAD_RESPONSE', 'EKT redirect was rejected', 502, false);
        if (response.ok) {
          try {
            const data: unknown = await response.json();
            if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Not an object');
            return data as RawProduct;
          } catch { throw new CatalogError('UPSTREAM_BAD_RESPONSE', 'EKT returned invalid JSON', 502, false); }
        }
        if (response.status !== 429 && response.status < 500) throw new CatalogError('UPSTREAM_BAD_RESPONSE', 'EKT rejected the request', 502, false);
        const retryAfter = response.headers.get('retry-after');
        const retryDelay = retryAfter
          ? /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now())
          : 0;
        const delay = Math.max(Number.isFinite(retryDelay) ? retryDelay : 0, 150 * (attempt + 1));
        if (attempt === 2 || delay >= deadline - Date.now()) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      throw new CatalogError('UPSTREAM_UNAVAILABLE', 'EKT catalog is temporarily unavailable', 503, true);
    });
    this.pending.set(key, job);
    try { return await job; }
    finally { this.pending.delete(key); }
  }

  async getPage(page: number): Promise<CatalogPage> {
    const params = new URLSearchParams();
    if (page !== 1) params.set('page', String(page));
    const raw = await this.request('/api/products', params);
    if (!raw || !Array.isArray(raw.items)) throw new CatalogError('UPSTREAM_BAD_RESPONSE', 'EKT page has no items', 502, false);
    return {
      page: typeof raw.page === 'number' ? raw.page : page,
      perPage: typeof raw.per_page === 'number' ? raw.per_page : raw.items.length,
      reportedCount: typeof raw.count === 'number' ? raw.count : null,
      items: raw.items as RawProduct[], source: 'ekt_live', fetchedAt: new Date().toISOString(),
    };
  }

  async getProduct(id: number): Promise<CatalogRecord | null> {
    const raw = await this.request('/api/products/detail', new URLSearchParams({ id: String(id) }));
    return raw ? { raw, source: 'ekt_live', fetchedAt: new Date().toISOString(), detailAvailable: true } : null;
  }
}
