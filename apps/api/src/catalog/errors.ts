export class CatalogError extends Error {
  constructor(
    public readonly code: 'UPSTREAM_UNAVAILABLE' | 'UPSTREAM_AUTH_FAILED' | 'UPSTREAM_BAD_RESPONSE' | 'FIXTURE_MISSING',
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) { super(message); }
}
