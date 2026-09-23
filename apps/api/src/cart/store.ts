import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import pg from 'pg';
import type { CatalogProvider } from '../catalog/types.js';
import { normalizeProduct } from '../catalog/normalize.js';

export class CartError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) { super(message); }
}

export interface Session { id: string; csrf: string }
export interface CartLine {
  product_id: number; store_id: number; quantity: string; unit: string;
  price_amount: string; currency: string; fact_source: 'synthetic';
}
export interface Cart { version: number; items: CartLine[]; total: { amount: string; currency: string }; cart_mode: 'demo' }
export interface Proposal {
  proposal_id: string; version: number; expires_at: string; cart_version: number;
  items: CartLine[]; total: { amount: string; currency: string }; cart_mode: 'demo';
  source: 'synthetic'; status: 'active';
}
export interface ConfirmResult { cart: Cart; cart_mode: 'demo'; stock_source: 'synthetic'; cart_url: '/cart' }

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const whole = (value: string) => {
  if (!/^\d+(?:\.0+)?$/.test(value)) throw new CartError('INVALID_DEMO_AMOUNT', 'Demo amount must be a whole number', 500);
  return value.split('.')[0]!;
};
const quantity = (value: string) => {
  if (!/^[1-9]\d{0,5}$/.test(value)) throw new CartError('INVALID_QUANTITY', 'Only positive whole demo units are supported', 400);
  return BigInt(value);
};
const total = (items: CartLine[]) => items.reduce((sum, item) => sum + BigInt(whole(item.price_amount)) * BigInt(whole(item.quantity)), 0n).toString();

export class PgDemoCartStore {
  constructor(private readonly pool: pg.Pool, private readonly catalog: CatalogProvider) {}

  async session(existingId?: string): Promise<Session> {
    const csrf = randomBytes(32).toString('hex');
    if (existingId && /^[0-9a-f-]{36}$/i.test(existingId)) {
      const updated = await this.pool.query(`UPDATE demo_sessions SET csrf_hash=$1, expires_at=now()+interval '1 day'
        WHERE id=$2 AND expires_at>now() RETURNING id`, [sha(csrf), existingId]);
      if (updated.rowCount) return { id: existingId, csrf };
    }
    const id = randomUUID();
    await this.pool.query('INSERT INTO demo_sessions(id, csrf_hash, expires_at) VALUES($1,$2,now()+interval \'1 day\')', [id, sha(csrf)]);
    await this.pool.query('INSERT INTO demo_carts(session_id) VALUES($1)', [id]);
    return { id, csrf };
  }

  async authenticate(id: string | undefined, token?: string): Promise<string> {
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new CartError('SESSION_REQUIRED', 'Start a demo session first', 401);
    const found = await this.pool.query<{ csrf_hash: string }>('SELECT csrf_hash FROM demo_sessions WHERE id=$1 AND expires_at>now()', [id]);
    if (!found.rows[0]) throw new CartError('SESSION_REQUIRED', 'Start a demo session first', 401);
    if (token !== undefined) {
      const received = Buffer.from(sha(token), 'hex');
      const expected = Buffer.from(found.rows[0].csrf_hash, 'hex');
      if (!timingSafeEqual(received, expected)) throw new CartError('CSRF_INVALID', 'CSRF token is invalid', 403);
    }
    return id;
  }

  private async cartWith(client: pg.PoolClient, sessionId: string): Promise<Cart> {
    const version = await client.query<{ version: number }>('SELECT version FROM demo_carts WHERE session_id=$1', [sessionId]);
    const rows = await client.query<CartLine>(`SELECT product_id::integer, store_id, quantity::text, unit,
      price_amount::text, currency, fact_source FROM demo_cart_items WHERE session_id=$1 ORDER BY product_id,store_id`, [sessionId]);
    const items = rows.rows.map((line) => ({ ...line, quantity: whole(line.quantity), price_amount: whole(line.price_amount) }));
    return { version: version.rows[0]?.version ?? 0, items, total: { amount: total(items), currency: 'KZT' }, cart_mode: 'demo' };
  }

  async getCart(sessionId: string): Promise<Cart> {
    const client = await this.pool.connect();
    try { return await this.cartWith(client, sessionId); }
    finally { client.release(); }
  }

  async getProposalStatus(sessionId: string, proposalId: string) {
    const found = await this.pool.query<{ status: string; expires_at: Date }>(
      'SELECT status,expires_at FROM demo_cart_proposals WHERE id=$1 AND session_id=$2', [proposalId, sessionId]);
    const proposal = found.rows[0];
    if (!proposal) throw new CartError('PROPOSAL_NOT_FOUND', 'Proposal is not owned by this session', 404);
    const status: 'applied' | 'not-applied' | 'unknown' = proposal.status === 'consumed' ? 'applied'
      : proposal.status === 'cancelled' || proposal.expires_at.getTime() <= Date.now() ? 'not-applied' : 'unknown';
    return { status, cart: await this.getCart(sessionId), cart_mode: 'demo' as const };
  }

  private async resolveLine(productId: number, storeId: number, requested: string): Promise<CartLine> {
    const qty = quantity(requested);
    const record = await this.catalog.getProduct(productId);
    if (!record || record.source !== 'synthetic') throw new CartError('PURCHASE_RULES_UNKNOWN', 'Purchase rules are not confirmed for this product');
    const product = normalizeProduct(record, 'demo');
    const policy = product.purchase_rules;
    if (!policy?.unit || policy.min_quantity !== '1' || policy.quantity_step !== '1' || product.stock.selected_store_id !== storeId ||
      !product.price.amount || !/^\d+$/.test(product.price.amount) || product.price.currency !== 'KZT' || product.stock.sellable_quantity === null) {
      throw new CartError('PURCHASE_RULES_UNKNOWN', 'Demo purchase rules are unavailable');
    }
    if (qty > BigInt(product.stock.sellable_quantity)) throw new CartError('INSUFFICIENT_STOCK', 'Requested quantity exceeds demo stock');
    return { product_id: productId, store_id: storeId, quantity: requested, unit: policy.unit,
      price_amount: product.price.amount, currency: 'KZT', fact_source: 'synthetic' };
  }

  async createProposal(sessionId: string, requested: Array<{ product_id: number; store_id: number; quantity: string }>): Promise<Proposal> {
    const seen = new Set<string>();
    const items: CartLine[] = [];
    for (const item of requested) {
      const key = `${item.product_id}:${item.store_id}`;
      if (seen.has(key)) throw new CartError('DUPLICATE_ITEM', 'Duplicate product and store', 400);
      seen.add(key);
      items.push(await this.resolveLine(item.product_id, item.store_id, item.quantity));
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cart = await client.query<{ version: number }>('SELECT version FROM demo_carts WHERE session_id=$1 FOR UPDATE', [sessionId]);
      if (!cart.rows[0]) throw new CartError('SESSION_REQUIRED', 'Start a demo session first', 401);
      const proposalId = randomUUID();
      await client.query("UPDATE demo_cart_proposals SET status='cancelled' WHERE session_id=$1 AND status='active'", [sessionId]);
      const inserted = await client.query<{ expires_at: Date }>(`INSERT INTO demo_cart_proposals
        (id,session_id,cart_version,status,expires_at,lines,total_amount,currency)
        VALUES($1,$2,$3,'active',now()+interval '5 minutes',$4::jsonb,$5::numeric,'KZT') RETURNING expires_at`,
      [proposalId, sessionId, cart.rows[0].version, JSON.stringify(items), total(items)]);
      await client.query('COMMIT');
      return { proposal_id: proposalId, version: 1, expires_at: inserted.rows[0]!.expires_at.toISOString(),
        cart_version: cart.rows[0].version, items, total: { amount: total(items), currency: 'KZT' },
        cart_mode: 'demo', source: 'synthetic', status: 'active' };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async cancel(sessionId: string, proposalId: string): Promise<void> {
    const updated = await this.pool.query(`UPDATE demo_cart_proposals SET status='cancelled'
      WHERE id=$1 AND session_id=$2 AND status='active'`, [proposalId, sessionId]);
    if (!updated.rowCount) throw new CartError('PROPOSAL_NOT_FOUND', 'Proposal is not active or owned by this session', 404);
  }

  async confirm(sessionId: string, proposalId: string, proposalVersion: number, key: string): Promise<ConfirmResult> {
    const requestHash = sha(JSON.stringify({ proposalId, proposalVersion }));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cartRow = await client.query<{ version: number }>('SELECT version FROM demo_carts WHERE session_id=$1 FOR UPDATE', [sessionId]);
      if (!cartRow.rows[0]) throw new CartError('SESSION_REQUIRED', 'Start a demo session first', 401);
      const prior = await client.query<{ request_hash: string; response_json: unknown }>(
        'SELECT request_hash,response_json FROM demo_cart_idempotency WHERE session_id=$1 AND key=$2', [sessionId, key]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== requestHash) throw new CartError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used for another request');
        await client.query('COMMIT');
        return prior.rows[0].response_json as ConfirmResult;
      }
      const proposalResult = await client.query<{
        version: number; cart_version: number; status: string; expires_at: Date; lines: CartLine[];
      }>('SELECT version,cart_version,status,expires_at,lines FROM demo_cart_proposals WHERE id=$1 AND session_id=$2 FOR UPDATE', [proposalId, sessionId]);
      const proposal = proposalResult.rows[0];
      if (!proposal) throw new CartError('PROPOSAL_NOT_FOUND', 'Proposal is not owned by this session', 404);
      if (proposal.status !== 'active' || proposal.expires_at.getTime() <= Date.now()) throw new CartError('PROPOSAL_NOT_ACTIVE', 'Proposal is no longer active');
      if (proposal.version !== proposalVersion || proposal.cart_version !== cartRow.rows[0].version) throw new CartError('CART_VERSION_CHANGED', 'Cart changed; create a new proposal');
      for (const line of proposal.lines) {
        const fresh = await this.resolveLine(line.product_id, line.store_id, line.quantity);
        if (fresh.price_amount !== line.price_amount || fresh.unit !== line.unit || fresh.currency !== line.currency || fresh.fact_source !== line.fact_source) {
          throw new CartError('PRICE_OR_RULES_CHANGED', 'Demo product facts changed; create a new proposal');
        }
        const existing = await client.query<{ quantity: string }>(`SELECT quantity::text FROM demo_cart_items
          WHERE session_id=$1 AND product_id=$2 AND store_id=$3`, [sessionId, line.product_id, line.store_id]);
        const record = await this.catalog.getProduct(line.product_id);
        const stock = record ? normalizeProduct(record, 'demo').stock.sellable_quantity : null;
        if (stock === null || BigInt(whole(existing.rows[0]?.quantity ?? '0')) + BigInt(line.quantity) > BigInt(whole(stock))) {
          throw new CartError('INSUFFICIENT_STOCK', 'Existing cart plus requested quantity exceeds demo stock');
        }
      }
      for (const line of proposal.lines) {
        await client.query(`INSERT INTO demo_cart_items
          (session_id,product_id,store_id,quantity,unit,price_amount,currency,fact_source)
          VALUES($1,$2,$3,$4::numeric,$5,$6::numeric,$7,$8)
          ON CONFLICT (session_id,product_id,store_id) DO UPDATE SET
          quantity=demo_cart_items.quantity+EXCLUDED.quantity,
          unit=EXCLUDED.unit,price_amount=EXCLUDED.price_amount,currency=EXCLUDED.currency,fact_source=EXCLUDED.fact_source`,
        [sessionId, line.product_id, line.store_id, line.quantity, line.unit, line.price_amount, line.currency, line.fact_source]);
      }
      await client.query('UPDATE demo_carts SET version=version+1 WHERE session_id=$1', [sessionId]);
      await client.query("UPDATE demo_cart_proposals SET status='consumed' WHERE id=$1", [proposalId]);
      const result: ConfirmResult = { cart: await this.cartWith(client, sessionId), cart_mode: 'demo',
        stock_source: 'synthetic', cart_url: '/cart' };
      await client.query('INSERT INTO demo_cart_idempotency(session_id,key,request_hash,response_json) VALUES($1,$2,$3,$4::jsonb)',
        [sessionId, key, requestHash, JSON.stringify(result)]);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
