import { z } from 'zod';

const schema = z.object({
  CATALOG_MODE: z.enum(['fixture', 'live']).default('fixture'),
  CART_MODE: z.enum(['demo', 'ekt']).default('demo'),
  AI_MODE: z.literal('stub').default('stub'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  DATABASE_URL: z.string().min(1).optional(),
  EKT_API_USER: z.string().min(1).optional(),
  EKT_API_PASSWORD: z.string().min(1).optional(),
  EKT_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
  EKT_MAX_CONCURRENT: z.coerce.number().int().min(1).max(8).default(3),
  ML_CORE_URL: z.url().optional(),
  ALLOWED_ORIGIN: z.url().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env.AI_MODE === 'openai') {
    throw new Error('AI_MODE=openai is not implemented; use AI_MODE=stub');
  }
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  }
  if (parsed.data.CATALOG_MODE === 'live' && (!parsed.data.EKT_API_USER || !parsed.data.EKT_API_PASSWORD)) {
    throw new Error('Live catalog requires EKT_API_USER and EKT_API_PASSWORD');
  }
  return parsed.data;
}
