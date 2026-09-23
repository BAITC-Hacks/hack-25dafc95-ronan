import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import { ZodTypeProvider, jsonSchemaTransform, serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { z } from 'zod';
import { CatalogError } from './catalog/errors.js';
import { normalizeProduct, productMatches } from './catalog/normalize.js';
import type { CatalogProvider, CatalogRecord } from './catalog/types.js';
import type { Config } from './config.js';
import { errorResponse, productResponse, searchResponse } from './schemas.js';
import { CartError, type PgDemoCartStore } from './cart/store.js';
import { registerCartRoutes } from './cart/routes.js';
import { MlCoreClient, fallbackQuery } from './ml/client.js';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const searchQuery = z.object({ q: z.string().trim().min(1).max(100).optional() });

export async function buildApp(config: Config, catalog: CatalogProvider, services: { cart?: PgDemoCartStore; ml?: MlCoreClient } = {}) {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger, {
    openapi: { info: { title: 'EKT Assistant API', version: '0.1.0' } },
    transform: jsonSchemaTransform,
  });

  app.setErrorHandler((error, request, reply) => {
    const catalogError = error instanceof CatalogError ? error : null;
    const cartError = error instanceof CartError ? error : null;
    const frameworkStatus = typeof error === 'object' && error !== null && 'statusCode' in error &&
      typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    const status = catalogError?.status ?? cartError?.status ?? (typeof error === 'object' && error !== null && 'validation' in error ? 400 : frameworkStatus);
    reply.status(status).send({ error: {
      code: catalogError?.code ?? cartError?.code ?? (status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'),
      message: catalogError?.message ?? cartError?.message ?? (status === 400 ? 'Invalid request' : 'Internal server error'),
      request_id: request.id,
      retryable: catalogError?.retryable ?? false,
    } });
  });

  app.get('/api/health', {
    schema: { response: { 200: z.object({ status: z.literal('ok'), version: z.string(), catalog_mode: z.string(), cart_mode: z.string(), ai_mode: z.string() }) } },
  }, async () => ({ status: 'ok' as const, version: '0.1.0', catalog_mode: config.CATALOG_MODE, cart_mode: config.CART_MODE, ai_mode: config.AI_MODE }));

  app.get('/api/products', {
    schema: { querystring: searchQuery, response: { 200: searchResponse, 400: errorResponse, 503: errorResponse } },
  }, async (request) => {
    const page = await catalog.getPage(config.CATALOG_MODE === 'fixture' ? 2 : 1);
    const detail = config.CATALOG_MODE === 'fixture' ? await catalog.getProduct(515291) : null;
    const extras = await catalog.listExtras?.() ?? [];
    const candidates: CatalogRecord[] = page.items.map((raw) => detail && raw.id === detail.raw.id ? detail : { raw, source: page.source, fetchedAt: page.fetchedAt, detailAvailable: false });
    candidates.push(...extras);
    const matches = candidates.map((record) => ({ record, result: request.query.q ? productMatches(record.raw, request.query.q) : { rank: 0, match: 'visible_page' as const } }))
      .filter((entry) => entry.result !== null)
      .sort((a, b) => (a.result?.rank ?? 99) - (b.result?.rank ?? 99));
    const items = matches.map(({ record, result }) => ({
      product: normalizeProduct(record, config.CART_MODE),
      match: result!.match,
    }));
    return { items, coverage: { complete: false as const, inspected_pages: [page.page], reported_count: page.reportedCount, note: 'Partial catalog coverage; no match does not prove absence from EKT.' } };
  });

  app.get('/api/products/:id', { schema: { params: idParams, response: { 200: productResponse, 400: errorResponse, 404: errorResponse, 503: errorResponse } } }, async (request, reply) => {
    const record: CatalogRecord | null = await catalog.getProduct(request.params.id);
    if (!record) return reply.status(404).send({ error: { code: 'PRODUCT_NOT_IN_COVERAGE', message: 'Product is not in the inspected catalog coverage', request_id: request.id, retryable: false } });
    return normalizeProduct(record, config.CART_MODE);
  });

  const chatBody = z.object({
    message: z.string().trim().min(1).max(1000),
    locale: z.enum(['ru']).optional(),
    context: z.object({ product_id: z.number().int().positive().optional(), store_id: z.number().int().positive().optional() }).strict().optional(),
    attachment_ids: z.array(z.string()).max(0).optional(),
  }).strict();
  app.post('/api/chat', { schema: { body: chatBody, response: { 200: z.object({
    answer: z.string(), products: z.array(productResponse), ml_status: z.enum(['ok', 'unavailable', 'disabled']),
    cart_mode: z.enum(['demo', 'ekt']), catalog_complete: z.literal(false),
  }) } } }, async (request) => {
    const page = await catalog.getPage(config.CATALOG_MODE === 'fixture' ? 2 : 1);
    const extras = await catalog.listExtras?.() ?? [];
    const records: CatalogRecord[] = page.items.map((raw) => ({ raw, source: page.source, fetchedAt: page.fetchedAt, detailAvailable: false }));
    records.push(...extras);
    const candidates = records.map((record) => ({ id: Number(record.raw.id), name: String(record.raw.name ?? ''), article: String(record.raw.article ?? '') }));
    const ml = await (services.ml ?? new MlCoreClient(config.ML_CORE_URL)).parseRank(request.body.message, candidates);
    const query = ml.query ?? fallbackQuery(request.body.message);
    const ranked = new Map(ml.rankedIds.map((id, index) => [id, index]));
    const matches = records.filter((record) => productMatches(record.raw, query) || ranked.has(Number(record.raw.id)))
      .sort((a, b) => (ranked.get(Number(a.raw.id)) ?? 100) - (ranked.get(Number(b.raw.id)) ?? 100)).slice(0, 5);
    const products = await Promise.all(matches.map(async (record) => {
      const id = Number(record.raw.id);
      const detail = id === 515291 || record.source === 'synthetic' ? await catalog.getProduct(id) : null;
      return normalizeProduct(detail ?? record, config.CART_MODE);
    }));
    return {
      answer: products.length ? `Найдено ${products.length} товаров в просмотренной части каталога. Проверьте карточки и источник данных.`
        : 'В просмотренной части каталога совпадений нет; это не означает отсутствие товара в магазине.',
      products, ml_status: ml.status, cart_mode: config.CART_MODE, catalog_complete: false as const,
    };
  });

  await registerCartRoutes(app, config, services.cart);

  app.get('/api/openapi.json', async () => app.swagger());
  return app;
}
