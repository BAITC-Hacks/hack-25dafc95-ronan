import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiSource } from "./apiSource";
import type { Proposal } from "./types";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const session = () => reply({ csrf_token: crypto.randomUUID() });
const failure = (code: string) => reply({ error: { code, message: "Request rejected" } }, 403);
const proposal = { id: "test-proposal" } as Proposal;
const empty = { version: 0, items: [] };

afterEach(() => vi.unstubAllGlobals());

describe("API cart mutations", () => {
  it("waits for the server cancellation response and preserves session/CSRF", async () => {
    let complete: (response: Response) => void = () => {};
    const cancelled = new Promise<Response>((resolve) => { complete = resolve; });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session())
      .mockReturnValueOnce(cancelled);
    vi.stubGlobal("fetch", fetchMock);
    let finished = false;
    const result = createApiSource().cancel!(proposal.id).then(() => { finished = true; });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(finished).toBe(false);
    const [path, options] = fetchMock.mock.calls[1];
    expect(path).toBe("/api/cart/proposals/test-proposal/cancel");
    expect(options).toMatchObject({ method: "POST", credentials: "same-origin", body: "{}" });
    expect(new Headers(options?.headers).get("x-csrf-token")).toBeTruthy();
    complete(reply({ status: "cancelled", cart_mode: "demo" }));
    await result;
    expect(finished).toBe(true);
  });

  it("propagates cancellation failure and preserves the API error code", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(failure("PROPOSAL_NOT_FOUND"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createApiSource().cancel!(proposal.id)).rejects.toMatchObject({
      code: "PROPOSAL_NOT_FOUND", status: 403,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes a stale token once and retries the identical confirm with its original key", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(failure("CSRF_INVALID"))
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(reply({ cart: empty }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createApiSource().commit(proposal)).resolves.toMatchObject({ kind: "applied" });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/session", "/api/cart/proposals/test-proposal/confirm",
      "/api/session", "/api/cart/proposals/test-proposal/confirm",
    ]);
    const first = fetchMock.mock.calls[1][1]!;
    const retry = fetchMock.mock.calls[3][1]!;
    const firstHeaders = new Headers(first.headers);
    const retryHeaders = new Headers(retry.headers);
    expect(retry.body).toBe(first.body);
    expect(retry.method).toBe(first.method);
    expect(retry.credentials).toBe("same-origin");
    expect(firstHeaders.get("idempotency-key")).toBe(proposal.id);
    expect(retryHeaders.get("idempotency-key")).toBe(proposal.id);
    expect(retryHeaders.get("x-csrf-token")).not.toBe(firstHeaders.get("x-csrf-token"));
    expect(retryHeaders.has("origin")).toBe(false); // Browser supplies the real Origin.
  });

  it("stops after one CSRF refresh when the repeated mutation is rejected", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(failure("CSRF_INVALID"))
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(failure("CSRF_INVALID"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createApiSource().commit(proposal)).rejects.toMatchObject({ code: "CSRF_INVALID" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(["network", "ORIGIN_INVALID"])("never retries an uncertain or unrelated %s failure", async (kind) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(session());
    if (kind === "network") fetchMock.mockRejectedValueOnce(new TypeError("Network error"));
    else fetchMock.mockResolvedValueOnce(failure(kind));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createApiSource().commit(proposal)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

it("shows an EKT published price without assuming currency or enabling purchase", async () => {
  const raw = {
    id: 515291, article: "200300285_", supplier_article: "027228", name: "Test product",
    price: { amount: "64920", currency: null },
    stock: { reported_total: null, selected_store_id: null, selected_store_raw_name: null,
      reported_store_quantity: null, sellable_quantity: null },
    purchase_rules: null, warnings: [], provenance: { source: "user_snapshot", freshness: "unknown" },
  };
  vi.stubGlobal("fetch", vi.fn<typeof fetch>()
    .mockResolvedValueOnce(reply({ items: [{ product: raw }] }))
    .mockResolvedValueOnce(reply(raw)));
  const [product] = await createApiSource().getCatalog();
  expect(product.specs["Опубликованная цена"]).toBe("64920; валюта не указана");
  expect(product.sku).toBe("027228");
  expect(product.specs["Внутренний артикул"]).toBe("200300285_");
  expect(product.price).toBeNull();
  expect(product.canPurchase).toBe(false);
});
