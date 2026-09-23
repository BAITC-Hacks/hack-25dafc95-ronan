import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_API, "Requires running Node API and PostgreSQL");

test("API session: search, card, proposal, confirm, and same cart after reload", async ({ page }) => {
  const calls: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/")) calls.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`);
  });
  await page.goto("/");
  await page.getByLabel("Источник данных").selectOption("api");
  await expect(page.locator(".chat-header h2")).toContainText("API");
  await expect(page.locator(".showcase-card").first()).toBeVisible();

  const input = page.getByRole("textbox", { name: "Сообщение помощнику" });
  await input.fill("DEMO_001");
  await input.press("Enter");
  const card = page.locator(".chat-column .product-card").last();
  await expect(card).toContainText("Демо автоматический выключатель");
  await card.getByRole("button", { name: "В корзину" }).click();
  await expect(page.locator(".proposal.active")).toBeVisible();
  await expect(page.locator(".cart-column .count")).toHaveText("0");
  const before = await page.evaluate(() => fetch("/api/cart").then((response) => response.json()));
  expect(before.items).toHaveLength(0);
  await input.fill("да");
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/chat") && response.status() === 200),
    input.press("Enter"),
  ]);
  const afterBareYes = await page.evaluate(() => fetch("/api/cart").then((response) => response.json()));
  expect(afterBareYes.items).toHaveLength(0);
  await page.getByRole("button", { name: "Да, добавить" }).click();
  await expect(page.locator(".cart-column .count")).toHaveText("1");
  const nodeCartPage = await page.request.get("http://127.0.0.1:8000/cart");
  expect(nodeCartPage.status()).toBe(200);
  expect(await nodeCartPage.text()).toContain("900000001");
  await page.getByRole("link", { name: "Открыть актуальную корзину" }).click();
  await expect(page).toHaveURL(/#\/cart$/);
  await expect(page.locator(".cart-page .cart-line h4")).toContainText("Демо автоматический выключатель");
  await page.reload();
  await expect(page.locator(".cart-page .cart-line h4")).toContainText("Демо автоматический выключатель");

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
