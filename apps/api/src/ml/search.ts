import { productMatches } from '../catalog/normalize.js';
import type { CatalogRecord } from '../catalog/types.js';

// A brand (e.g. Legrand) or a rating (e.g. 18kA) is not an article.
export function identifierQuery(message: string): string | null {
  return message.match(/(?<![\p{L}\p{N}_])(?:\d{4,}_?|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)(?![\p{L}\p{N}_])/u)?.[0] ?? null;
}

const currentPattern = /(?<![\p{L}\p{N}_])(\d+(?:[.,]\d+)?)\s*[аa](?![\p{L}\p{N}_])/giu;
const currents = (text: string): number[] => [...text.matchAll(currentPattern)].map((match) => Number(match[1]!.replace(',', '.')));
const kinds = [
  /(?:автомат[а-яё]*|автоматическ[а-яё]*\s+выключател[а-яё]*|(?<![\p{L}])ав(?![\p{L}]))/iu,
  /реле/iu, /контактор[а-яё]*/iu, /кабел[а-яё]*/iu, /ламп[а-яё]*/iu,
];
const stopWords = new Set(['нужен', 'нужна', 'нужно', 'нужны', 'найди', 'найти', 'подбери', 'покажи', 'есть', 'ищу', 'мне', 'на', 'в', 'для', 'и', 'с', 'по', 'а', 'a']);

/** Catalog facts alone decide eligibility; ML may only change the order. */
export function catalogQueryMatch(record: CatalogRecord, message: string): ReturnType<typeof productMatches> {
  const exact = productMatches(record.raw, message);
  if (exact?.match === 'exact_identifier') return exact;
  const identifier = identifierQuery(message);
  if (identifier) return productMatches(record.raw, identifier);

  const name = String(record.raw.name ?? '');
  const requestedKind = kinds.find((kind) => kind.test(message));
  if (requestedKind && !requestedKind.test(name)) return null;

  const requestedCurrents = currents(message);
  if (requestedCurrents.length) {
    const properties = record.raw.properties;
    const nominal = properties && typeof properties === 'object' && !Array.isArray(properties)
      ? (properties as Record<string, unknown>).NOMINALNYY_TOK : undefined;
    // Snapshot names alone are insufficient confirmation of a technical rating.
    const known = nominal === undefined && record.source === 'synthetic' ? currents(name) : currents(String(nominal ?? ''));
    const nameClaims = currents(name);
    if (new Set(requestedCurrents).size !== 1 || new Set(known).size !== 1 || known[0] !== requestedCurrents[0]
      || nameClaims.some((value) => value !== known[0])) return null;
  }

  const text = message.replace(currentPattern, ' ').toLocaleLowerCase();
  const terms = (text.match(/[\p{L}\p{N}_]+/gu) ?? [])
    .filter((term) => !stopWords.has(term) && (/\d/u.test(term)
      || (!kinds.some((kind) => kind.test(term)) && !/^выключател/iu.test(term))));
  const haystack = name.toLocaleLowerCase();
  if (!requestedKind && !requestedCurrents.length && !terms.length) return null;
  return terms.every((term) => haystack.includes(term)) ? { rank: 1, match: 'name' } : null;
}
