import { expect, test, type Page, type Request } from "@playwright/test";

test.skip(process.env.E2E_API !== "1", "Requires real frontend proxy, Node, Python ml_core and PostgreSQL");

type ChatResponse = {
  answer: string;
  ml_status: string;
  products: { id: number; article: string | null; supplier_article: string | null; name: string | null; warnings: { code: string }[] }[];
};

async function openApi(page: Page) {
  const sessionResponse = page.waitForResponse((response) => response.url().endsWith("/api/session") && response.request().method() === "POST");
  await page.goto("/");
  const source = page.getByLabel("Источник данных");
  if (await source.inputValue() !== "api") await source.selectOption("api");
  // This is the frontend's actual same-origin request through the Vite proxy.
  expect((await sessionResponse).status()).toBe(200);
  await expect(page.locator(".chat-header h2")).toContainText("API");
  await expect(page.locator(".showcase-card").first()).toBeVisible();
}

async function chat(page: Page, message: string): Promise<ChatResponse> {
  const input = page.getByRole("textbox", { name: "Сообщение помощнику" });
  await input.fill(message);
  const [response] = await Promise.all([
    page.waitForResponse((result) => result.url().endsWith("/api/chat")),
    input.press("Enter"),
  ]);
  expect(response.status()).toBe(200);
  const body = await response.json() as ChatResponse;
  expect(body.ml_status).toBe("ok");
  return body;
}

async function proposeDemo(page: Page) {
  const found = await chat(page, "DEMO_001");
  expect(found.products.map((product) => product.id)).toContain(900000001);
  const card = page.locator(".chat-column .product-card").last();
  await expect(card).toContainText("Демо автоматический выключатель");
  const [response] = await Promise.all([
    page.waitForResponse((result) => result.url().endsWith("/api/cart/proposals")),
    card.getByRole("button", { name: "В корзину" }).click(),
  ]);
  expect(response.status()).toBe(200);
  await expect(page.locator(".proposal.active")).toBeVisible();
  return await response.json() as { proposal_id: string; version: number };
}

async function cart(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/cart");
    if (!response.ok) throw new Error(`Cart HTTP ${response.status}`);
    return response.json() as Promise<{ version: number; items: { product_id: number; quantity: string }[] }>;
  });
}

async function replay(page: Page, request: Request) {
  // Only non-secret request data crosses this boundary. Obtain the current CSRF
  // token inside the browser; never log it or cookies in diagnostics.
  return page.evaluate(async ({ path, body, key }) => {
    const session = await fetch("/api/session", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    if (!session.ok) throw new Error(`Session HTTP ${session.status}`);
    const { csrf_token } = await session.json();
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf_token, "idempotency-key": key },
      body,
    });
    return { status: response.status, body: await response.json() };
  }, {
    path: new URL(request.url()).pathname,
    body: request.postData(),
    key: request.headers()["idempotency-key"],
  });
}

test("real API: search, card, separate confirm, reload and idempotent replay", async ({ page }) => {
  const calls: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/")) calls.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`);
  });
  await openApi(page);
  await proposeDemo(page);
  await expect(page.locator(".cart-column .count")).toHaveText("0");
  expect((await cart(page)).items).toHaveLength(0);

  await chat(page, "да");
  expect((await cart(page)).items).toHaveLength(0);
  const [confirmed] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/confirm") && response.status() === 200),
    page.getByRole("button", { name: "Да, добавить" }).click(),
  ]);
  await expect(page.locator(".cart-column .count")).toHaveText("1");
  const after = await cart(page);
  expect(after.items).toMatchObject([{ product_id: 900000001, quantity: "1" }]);
  const nodeCartPage = await page.request.get("http://127.0.0.1:8000/cart");
  expect(nodeCartPage.status()).toBe(200);
  expect(await nodeCartPage.text()).toContain("900000001");
  await page.getByRole("link", { name: "Открыть актуальную корзину" }).click();
  await expect(page).toHaveURL(/#\/cart$/);
  await expect(page.locator(".cart-page .cart-line h4")).toContainText("Демо автоматический выключатель");
  await page.reload();
  await expect(page.locator(".cart-page .cart-line h4")).toContainText("Демо автоматический выключатель");
  expect(await cart(page)).toEqual(after);

  const repeated = await replay(page, confirmed.request());
  expect(repeated.status).toBe(200);
  expect(repeated.body.cart).toMatchObject(after);
  expect(await cart(page)).toEqual(after);
  for (const pattern of [
    /^GET \/api\/products 200$/,
    /^GET \/api\/products\/900000001 200$/,
    /^POST \/api\/session 200$/,
    /^POST \/api\/chat 200$/,
    /^POST \/api\/cart\/proposals 200$/,
    /^POST \/api\/cart\/proposals\/[\w-]+\/confirm 200$/,
    /^GET \/api\/cart 200$/,
  ]) expect(calls.some((call) => pattern.test(call)), `missing ${pattern}`).toBe(true);
});

test("real ML search preserves requested current, exact article and conflict", async ({ page }) => {
  await openApi(page);
  const current160 = await chat(page, "автомат 160 А");
  expect(current160.products).toEqual([]);
  expect(current160.answer).toMatch(/нет|не найден|не подтвержден/iu);
  const exact = await chat(page, "027228");
  const conflict = exact.products.find((product) => product.id === 515291);
  expect(conflict?.article).toBe("200300285_");
  expect(conflict?.supplier_article).toBe("027228");
  expect(conflict?.warnings.some((warning) => warning.code === "SPEC_CONFLICT")).toBe(true);
  await expect(page.locator(".chat-column .product-card").last()).toContainText("Конфликт характеристик");
  const current16 = await chat(page, "автомат 16 А");
  expect(current16.products.map((product) => product.id)).toEqual([900000001]);
});

test("real API cancellation reaches the server and prevents later confirm", async ({ page }) => {
  await openApi(page);
  const proposal = await proposeDemo(page);
  const [cancelled] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/${proposal.proposal_id}/cancel`)),
    page.getByRole("button", { name: "Отмена", exact: true }).click(),
  ]);
  expect(cancelled.status()).toBe(200);
  await expect(page.locator(".proposal.cancelled")).toBeVisible();
  expect((await cart(page)).items).toHaveLength(0);
  const lateConfirm = await page.evaluate(async ({ id, version }) => {
    const session = await fetch("/api/session", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    if (!session.ok) throw new Error(`Session HTTP ${session.status}`);
    const { csrf_token } = await session.json();
    const response = await fetch(`/api/cart/proposals/${id}/confirm`, {
      method: "POST", headers: {
        "content-type": "application/json", "x-csrf-token": csrf_token, "idempotency-key": crypto.randomUUID(),
      }, body: JSON.stringify({ proposal_version: version }),
    });
    const body = await response.json();
    return { status: response.status, code: body.error?.code };
  }, { id: proposal.proposal_id, version: proposal.version });
  expect(lateConfirm).toEqual({ status: 409, code: "PROPOSAL_NOT_ACTIVE" });
  expect((await cart(page)).items).toHaveLength(0);
});

test("real API two tabs refresh stale CSRF once and retain the confirm key", async ({ page, context }) => {
  await openApi(page);
  await proposeDemo(page);
  const secondTab = await context.newPage();
  await openApi(secondTab);
  expect((await cart(secondTab)).items).toHaveLength(0);

  const attempts: { status: number; key: string | undefined; body: string | null }[] = [];
  let refreshes = 0;
  page.on("response", (response) => {
    if (response.url().endsWith("/api/session")) refreshes += 1;
    if (response.url().endsWith("/confirm")) attempts.push({
      status: response.status(), key: response.request().headers()["idempotency-key"], body: response.request().postData(),
    });
  });
  await page.bringToFront();
  const [confirmed] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/confirm") && response.status() === 200),
    page.getByRole("button", { name: "Да, добавить" }).click(),
  ]);
  await expect(page.locator(".cart-column .count")).toHaveText("1");
  expect(attempts.map((attempt) => attempt.status)).toEqual([403, 200]);
  expect(refreshes).toBe(1);
  expect(Boolean(attempts[0]?.key)).toBe(true);
  expect(attempts[0]?.key).toBe(attempts[1]?.key);
  expect(attempts[0]?.body).toBe(attempts[1]?.body);
  const after = await cart(page);
  expect(after.items).toMatchObject([{ product_id: 900000001, quantity: "1" }]);
  expect(await cart(secondTab)).toEqual(after);
  expect((await replay(page, confirmed.request())).status).toBe(200);
  expect(await cart(secondTab)).toEqual(after);
});
