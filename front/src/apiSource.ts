import { emptyCart } from "./cartEngine";
import type { Cart, DataSource, Intent, Product, Proposal } from "./types";

type ApiProduct = {
  id: number;
  article: string | null;
  supplier_article: string | null;
  name: string | null;
  price: { amount: string | null; currency: string | null };
  stock: {
    reported_total: string | null;
    selected_store_id: number | null;
    selected_store_raw_name: string | null;
    reported_store_quantity: string | null;
    sellable_quantity: string | null;
  };
  purchase_rules: { unit: string | null; min_quantity: string | null; quantity_step: string | null } | null;
  warnings: { code: string; claims: { value: string }[] }[];
  provenance: { source: "synthetic" | "user_snapshot" | "ekt_live"; freshness: string };
};
type ApiCart = {
  version: number;
  items: { product_id: number; store_id: number; quantity: string; price_amount: string }[];
};
type ApiProposal = {
  proposal_id: string;
  version: number;
  cart_version: number;
  items: { price_amount: string; quantity: string }[];
};

function exactNumber(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function toProduct(raw: ApiProduct): Product {
  const synthetic = raw.provenance.source === "synthetic";
  const unit = synthetic ? raw.purchase_rules?.unit || "шт" : "неизвестна";
  const warehouse = raw.stock.selected_store_raw_name || "Склад не указан";
  const sellable = synthetic ? exactNumber(raw.stock.sellable_quantity) : null;
  const amount = synthetic && raw.price.currency === "KZT" ? exactNumber(raw.price.amount) : null;
  const specs: Record<string, string> = {
    Источник: synthetic ? "Синтетические данные демо" : raw.provenance.source === "user_snapshot" ? "Снимок EKT, не текущие данные" : "Ответ EKT API",
  };
  if (raw.article) specs["Внутренний артикул"] = raw.article;
  if (!synthetic && raw.price.amount !== null) {
    specs["Опубликованная цена"] = `${raw.price.amount}; ${raw.price.currency || "валюта не указана"}`;
  }
  if (raw.stock.reported_total !== null) specs["Опубликованный общий остаток"] = raw.stock.reported_total;
  if (!synthetic && raw.stock.reported_store_quantity !== null) specs[`Опубликовано: ${warehouse}`] = raw.stock.reported_store_quantity;
  if (raw.warnings.some((warning) => warning.code === "SPEC_CONFLICT")) {
    specs["Конфликт характеристик"] = raw.warnings.find((warning) => warning.code === "SPEC_CONFLICT")!.claims.map((claim) => claim.value).join(" / ");
  }
  return {
    id: String(raw.id), sku: raw.supplier_article || raw.article || String(raw.id),
    name: raw.name || "Название не предоставлено", category: synthetic ? "Синтетический демотовар" : "Каталог EKT",
    icon: /кабел|ввг/i.test(raw.name || "") ? "cable" : /автомат|\bАВ\b/i.test(raw.name || "") ? "breaker" : "box",
    price: amount, unit, step: synthetic ? exactNumber(raw.purchase_rules?.quantity_step ?? null) || 1 : 1,
    min: synthetic ? exactNumber(raw.purchase_rules?.min_quantity ?? null) || 1 : 1,
    stocks: [{ warehouse, quantity: sellable }], specs, certificate: null,
    canPurchase: synthetic && amount !== null && sellable !== null,
  };
}

class ApiError extends Error {
  constructor(message: string, readonly code: string | null, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    const message = error && typeof error === "object" && "message" in error ? String(error.message) : `API: HTTP ${response.status}`;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : null;
    throw new ApiError(message, code, response.status);
  }
  return body as T;
}

export function createApiSource(): DataSource {
  let csrf = "";
  let bootstrap: Promise<void> | null = null;
  let currentCart: Cart = emptyCart();
  const productMap = new Map<string, ApiProduct>();
  const ensureSession = () => {
    if (!bootstrap) bootstrap = request<{ csrf_token: string }>("/api/session", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }).then((session) => { csrf = session.csrf_token; }).catch((error) => { bootstrap = null; throw error; });
    return bootstrap;
  };
  const mutate = async <T>(path: string, body: string, idempotencyKey?: string): Promise<T> => {
    await ensureSession();
    const send = () => request<T>(path, {
      method: "POST", body,
      headers: {
        "content-type": "application/json", "x-csrf-token": csrf,
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
    });
    try { return await send(); }
    catch (error) {
      if (!(error instanceof ApiError) || error.code !== "CSRF_INVALID") throw error;
      // Another tab can rotate the shared session token. Only a CSRF rejection
      // permits one retry; the operation body and confirm key stay unchanged.
      bootstrap = null;
      await ensureSession();
      return send();
    }
  };
  const remember = (raw: ApiProduct) => { productMap.set(String(raw.id), raw); return toProduct(raw); };
  const mapCart = (raw: ApiCart): Cart => {
    const cart = { revision: raw.version, lines: raw.items.map((line) => ({
      productId: String(line.product_id),
      warehouse: productMap.get(String(line.product_id))?.stock.selected_store_raw_name || "Склад не указан",
      quantity: exactNumber(line.quantity) ?? 0,
      price: exactNumber(line.price_amount) ?? 0,
    })) };
    currentCart = cart;
    return cart;
  };

  return {
    mode: "api",
    cartUrl: "#/cart",
    async getCatalog() {
      const list = await request<{ items: { product: ApiProduct }[] }>("/api/products");
      const detailed = await Promise.all(list.items.map(async ({ product }) => {
        if (product.id !== 515291 && product.provenance.source !== "synthetic") return product;
        try { return await request<ApiProduct>(`/api/products/${product.id}`); }
        catch { return product; }
      }));
      return detailed.sort((a, b) => Number(b.provenance.source === "synthetic") - Number(a.provenance.source === "synthetic")).map(remember);
    },
    async getCart() {
      await ensureSession();
      const cart = await request<ApiCart>("/api/cart");
      await Promise.all(cart.items.filter((line) => !productMap.has(String(line.product_id)))
        .map(async (line) => remember(await request<ApiProduct>(`/api/products/${line.product_id}`))));
      return mapCart(cart);
    },
    async chat(text) {
      const result = await request<{ answer: string; products: ApiProduct[] }>("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, locale: "ru", attachment_ids: [] }),
      });
      return { text: result.answer, products: result.products.map(remember) };
    },
    async propose(intent: Intent): Promise<Proposal> {
      if (intent.kind !== "add") throw new Error("Изменение и удаление пока не подключены к серверной демо-корзине.");
      await ensureSession();
      const raw = productMap.get(intent.productId);
      if (!raw || raw.provenance.source !== "synthetic" || raw.stock.selected_store_raw_name !== intent.warehouse || raw.stock.selected_store_id === null) {
        throw new Error("Для этого товара нет подтверждённых демо-правил покупки.");
      }
      if (!Number.isSafeInteger(intent.quantity) || intent.quantity <= 0) throw new Error("Укажите целое положительное количество.");
      const response = await mutate<ApiProposal>("/api/cart/proposals", JSON.stringify({
          items: [{ product_id: raw.id, store_id: raw.stock.selected_store_id, quantity: String(intent.quantity) }],
        }));
      const product = toProduct(raw);
      const before = currentCart.lines.find((line) => line.productId === intent.productId && line.warehouse === intent.warehouse)?.quantity ?? 0;
      return { id: response.proposal_id, intent, product, before, after: before + intent.quantity,
        price: exactNumber(response.items[0]?.price_amount ?? null) ?? 0,
        available: exactNumber(raw.stock.sellable_quantity) ?? 0,
        revision: response.cart_version, status: "active" };
    },
    async commit(proposal) {
      const result = await mutate<{ cart: ApiCart }>(`/api/cart/proposals/${proposal.id}/confirm`,
        JSON.stringify({ proposal_version: 1 }), proposal.id);
      return { kind: "applied", cart: mapCart(result.cart) };
    },
    async cancel(proposalId) {
      await mutate(`/api/cart/proposals/${proposalId}/cancel`, "{}");
    },
    async reconcile(proposalId) {
      await ensureSession();
      const result = await request<{ status: "applied" | "not-applied" | "unknown"; cart: ApiCart }>(
        `/api/cart/proposals/${proposalId}/status`);
      return { status: result.status, cart: mapCart(result.cart) };
    },
  };
}
