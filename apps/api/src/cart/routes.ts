import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import { z } from 'zod';
import type { Config } from '../config.js';
import { CartError, type PgDemoCartStore } from './store.js';

const cookieName = 'ekt_demo_session';
const proposalBody = z.object({ items: z.array(z.object({
  product_id: z.number().int().positive(), quantity: z.string(), store_id: z.number().int().positive(),
}).strict()).min(1).max(10) }).strict();
const idParams = z.object({ id: z.uuid() });
const confirmBody = z.object({ proposal_version: z.number().int().positive() }).strict();
const lineSchema = z.object({
  product_id: z.number().int(), store_id: z.number().int(), quantity: z.string(), unit: z.string(),
  price_amount: z.string(), currency: z.string(), fact_source: z.literal('synthetic'),
});
const cartSchema = z.object({ version: z.number().int(), items: z.array(lineSchema),
  total: z.object({ amount: z.string(), currency: z.string() }), cart_mode: z.literal('demo') });
const proposalSchema = z.object({
  proposal_id: z.uuid(), version: z.number().int(), expires_at: z.string(), cart_version: z.number().int(),
  items: z.array(lineSchema), total: z.object({ amount: z.string(), currency: z.string() }),
  cart_mode: z.literal('demo'), source: z.literal('synthetic'), status: z.literal('active'),
});
const confirmSchema = z.object({ cart: cartSchema, cart_mode: z.literal('demo'),
  stock_source: z.literal('synthetic'), cart_url: z.literal('/cart') });
const html = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!);

function cookie(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie;
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}

function origin(request: FastifyRequest, config: Config) {
  const value = request.headers.origin;
  if (!value) throw new CartError('ORIGIN_REQUIRED', 'Origin header is required', 403);
  try {
    const parsed = new URL(value);
    const allowed = config.ALLOWED_ORIGIN === value || (parsed.host === request.headers.host &&
      (parsed.protocol === 'http:' || parsed.protocol === 'https:'));
    if (!allowed) throw new Error('Origin mismatch');
  } catch { throw new CartError('ORIGIN_INVALID', 'Origin is not allowed', 403); }
}

function storeOrError(config: Config, store?: PgDemoCartStore): PgDemoCartStore {
  if (config.CART_MODE === 'ekt') throw new CartError('INTEGRATION_NOT_CONFIGURED', 'EKT cart integration is not configured', 501);
  if (!store) throw new CartError('DATABASE_NOT_CONFIGURED', 'Demo cart database is not configured', 503);
  return store;
}

async function sessionFor(request: FastifyRequest, store: PgDemoCartStore, csrf = false) {
  const token = request.headers['x-csrf-token'];
  if (csrf && (typeof token !== 'string' || !token)) throw new CartError('CSRF_INVALID', 'CSRF token is required', 403);
  return store.authenticate(cookie(request), csrf ? token as string : undefined);
}

export async function registerCartRoutes(app: FastifyInstance, config: Config, store?: PgDemoCartStore) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const sessionStarts = new Map<string, { count: number; until: number }>();

  api.post('/api/session', { schema: { response: { 200: z.object({ csrf_token: z.string(), cart_mode: z.literal('demo'), expires_in_seconds: z.number().int() }) } } }, async (request, reply) => {
    origin(request, config);
    const now = Date.now();
    const bucket = sessionStarts.get(request.ip);
    const next = bucket && bucket.until > now ? { count: bucket.count + 1, until: bucket.until } : { count: 1, until: now + 60_000 };
    sessionStarts.set(request.ip, next);
    if (next.count > 20) throw new CartError('RATE_LIMITED', 'Too many session requests', 429);
    const cartStore = storeOrError(config, store);
    const session = await cartStore.session(cookie(request));
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    reply.header('set-cookie', `${cookieName}=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure}`);
    reply.header('cache-control', 'no-store');
    return { csrf_token: session.csrf, cart_mode: 'demo' as const, expires_in_seconds: 86400 };
  });

  api.get('/api/cart', { schema: { response: { 200: cartSchema } } }, async (request) => {
    const cartStore = storeOrError(config, store);
    const sessionId = await sessionFor(request, cartStore);
    return cartStore.getCart(sessionId);
  });

  api.get('/api/cart/proposals/:id/status', { schema: { params: idParams, response: { 200: z.object({
    status: z.enum(['applied', 'not-applied', 'unknown']), cart: cartSchema, cart_mode: z.literal('demo'),
  }) } } }, async (request) => {
    const cartStore = storeOrError(config, store);
    const sessionId = await sessionFor(request, cartStore);
    return cartStore.getProposalStatus(sessionId, request.params.id);
  });

  api.post('/api/cart/proposals', { schema: { body: proposalBody, response: { 200: proposalSchema } } }, async (request) => {
    origin(request, config);
    const cartStore = storeOrError(config, store);
    const sessionId = await sessionFor(request, cartStore, true);
    return cartStore.createProposal(sessionId, request.body.items);
  });

  api.post('/api/cart/proposals/:id/confirm', { schema: { params: idParams, body: confirmBody, response: { 200: confirmSchema } } }, async (request) => {
    origin(request, config);
    const cartStore = storeOrError(config, store);
    const sessionId = await sessionFor(request, cartStore, true);
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) throw new CartError('IDEMPOTENCY_KEY_REQUIRED', 'A unique Idempotency-Key is required', 400);
    return cartStore.confirm(sessionId, request.params.id, request.body.proposal_version, key);
  });

  api.post('/api/cart/proposals/:id/cancel', { schema: { params: idParams, response: { 200: z.object({ status: z.literal('cancelled'), cart_mode: z.literal('demo') }) } } }, async (request) => {
    origin(request, config);
    const cartStore = storeOrError(config, store);
    const sessionId = await sessionFor(request, cartStore, true);
    await cartStore.cancel(sessionId, request.params.id);
    return { status: 'cancelled' as const, cart_mode: 'demo' as const };
  });

  // Minimal same-origin demo page until the frontend owner supplies /cart.
  api.get('/cart', async (request, reply) => {
    const cartStore = storeOrError(config, store);
    const sessionId = await sessionFor(request, cartStore);
    const cart = await cartStore.getCart(sessionId);
    const rows = cart.items.map((item) => `<li>Демо-товар ${item.product_id}: ${html(item.quantity)} ${html(item.unit)} — ${html(item.price_amount)} ${html(item.currency)}</li>`).join('');
    reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'");
    return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Демо-корзина</title><h1>Демо-корзина</h1><p>Версия ${cart.version}. Это отдельная корзина прототипа, не EKT.</p><ul>${rows}</ul><p>Итого: ${cart.total.amount} ${cart.total.currency}</p></html>`;
  });
}
