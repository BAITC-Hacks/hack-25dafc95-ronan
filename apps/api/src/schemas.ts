import { z } from 'zod';

const nullableText = z.string().nullable();
const claim = z.object({ value: z.string(), source: z.string() });

export const errorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string(), request_id: z.string(), retryable: z.boolean() }),
});

export const productResponse = z.object({
  id: z.number().int(),
  article: nullableText,
  supplier_article: nullableText,
  barcode: nullableText,
  name: nullableText,
  description: nullableText,
  price: z.object({ amount: nullableText, currency: nullableText, currency_source: nullableText }),
  stock: z.object({
    reported_total: nullableText,
    selected_store_id: z.number().int().nullable(),
    selected_store_raw_name: nullableText,
    selected_store_display_name: nullableText,
    reported_store_quantity: nullableText,
    sellable_quantity: nullableText,
  }),
  purchase_rules: z.object({ unit: nullableText, min_quantity: nullableText, quantity_step: nullableText, source: z.literal('synthetic') }).nullable(),
  certificates: z.array(z.unknown()),
  warnings: z.array(z.object({ code: z.literal('SPEC_CONFLICT'), field: z.string(), claims: z.array(claim) })),
  provenance: z.object({
    source: z.enum(['user_snapshot', 'ekt_live', 'synthetic']),
    catalog_mode: z.enum(['fixture', 'live']),
    fetched_at: nullableText,
    freshness: z.enum(['snapshot', 'live_response', 'synthetic']),
    catalog_complete: z.literal(false),
    field_sources: z.object({
      article: nullableText, supplier_article: nullableText, price: nullableText,
      reported_total: nullableText, reported_store_quantity: nullableText,
    }),
  }),
  cart_mode: z.enum(['demo', 'ekt']),
  detail_available: z.boolean(),
});

export const searchResponse = z.object({
  items: z.array(z.object({ product: productResponse, match: z.enum(['exact_identifier', 'name']) })),
  coverage: z.object({
    complete: z.literal(false),
    inspected_pages: z.array(z.number().int()),
    reported_count: z.number().int().nullable(),
    note: z.string(),
  }),
});
