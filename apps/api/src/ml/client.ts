import { z } from 'zod';
import { identifierQuery } from './search.js';

export interface MlCandidate { id: number; name: string; article: string }
export interface MlResult { query: string | null; rankedIds: number[]; status: 'ok' | 'unavailable' | 'disabled' }
const responseSchema = z.object({
  query: z.string().trim().max(100).optional(),
  ranked_ids: z.array(z.number().int().positive()).max(20).optional(),
}).strict();

export class MlCoreClient {
  constructor(private readonly baseUrl: string | undefined, private readonly fetcher: typeof fetch = fetch) {}

  async parseRank(message: string, candidates: MlCandidate[]): Promise<MlResult> {
    if (!this.baseUrl) return { query: null, rankedIds: [], status: 'disabled' };
    try {
      const url = new URL('/v1/parse-rank', this.baseUrl);
      const response = await this.fetcher(url, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(800),
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ message, candidates }),
      });
      if (!response.ok) return { query: null, rankedIds: [], status: 'unavailable' };
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) return { query: null, rankedIds: [], status: 'unavailable' };
      const allowed = new Set(candidates.map((candidate) => candidate.id));
      const rankedIds = parsed.data.ranked_ids ?? [];
      if (new Set(rankedIds).size !== rankedIds.length || rankedIds.some((id) => !allowed.has(id))) {
        return { query: null, rankedIds: [], status: 'unavailable' };
      }
      return { query: parsed.data.query ?? null, rankedIds, status: 'ok' };
    } catch { return { query: null, rankedIds: [], status: 'unavailable' }; }
  }
}

export function fallbackQuery(message: string): string {
  return identifierQuery(message) ?? message.trim().slice(0, 100);
}
