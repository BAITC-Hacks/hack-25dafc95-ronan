import { test, expect } from "@playwright/test";
import { catalog } from "../src/catalog";
test.use({ baseURL: "http://127.0.0.1:5174" });
test("actual aborted request: retry has one user message and no demo fallback", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/__test__/chat", (route) => {
    calls++;
    return calls === 1
      ? route.abort("connectionfailed")
      : route.fulfill({ json: { text: "Ответ тестового API после повтора" } });
  });
  await page.goto("/harness.html");
  const input = page.getByRole("textbox", { name: "Сообщение помощнику" });
  await input.fill("Кабель");
  await input.press("Enter");
  await expect(page.locator(".product-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Повторить запрос" }).click();
  await expect(page.locator(".message").last()).toContainText(
    "Ответ тестового API после повтора",
  );
  await expect(page.locator(".message.user")).toHaveCount(1);
  expect(calls).toBe(2);
});
test("ambiguous mutation reconciles before allowing another change", async ({
  page,
}) => {
  let commits = 0,
    reconciles = 0;
  await page.route("**/__test__/chat", (r) =>
    r.fulfill({
      json: { text: "Тестовая карточка API", products: [catalog[0]] },
    }),
  );
  await page.route("**/__test__/commit", (r) => {
    commits++;
    return r.abort("connectionreset");
  });
  await page.route("**/__test__/reconcile?*", (r) => {
    reconciles++;
    return r.fulfill({
      json:
        reconciles === 1
          ? { status: "unknown", cart: { revision: 0, lines: [] } }
          : {
              status: "applied",
              cart: {
                revision: 1,
                lines: [
                  {
                    productId: "c1",
                    warehouse: catalog[0].stocks[0].warehouse,
                    quantity: 5,
                    price: 485,
                  },
                ],
              },
            },
    });
  });
  await page.goto("/harness.html");
  await page
    .getByRole("button", { name: "Кабель ВВГнг-LS 3×2,5", exact: true })
    .click();
  await page.getByRole("button", { name: "В корзину", exact: true }).click();
  await page.getByRole("button", { name: "Да, добавить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Статус операции пока неизвестен",
  );
  await expect(
    page.getByRole("button", { name: "В корзину", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".cart-column .count")).toHaveText("0");
  await page.getByRole("button", { name: "Сверить корзину" }).click();
  await expect(page.locator(".cart-column .count")).toHaveText("1");
  await expect(page.locator(".success-link")).toBeVisible();
  expect(commits).toBe(1);
  expect(reconciles).toBe(2);
});
test("changed price needs fresh consent and shows returned cart", async ({
  page,
}) => {
  let commits = 0;
  await page.route("**/__test__/chat", (r) =>
    r.fulfill({
      json: { text: "Тестовая карточка API", products: [catalog[0]] },
    }),
  );
  await page.route("**/__test__/commit", (r) => {
    commits++;
    const p = JSON.parse(r.request().postData()!);
    return r.fulfill({
      json:
        commits === 1
          ? {
              kind: "changed",
              cart: { revision: 0, lines: [] },
              proposal: {
                ...p,
                id: "new-operation",
                price: 500,
                product: { ...p.product, price: 500 },
                status: "active",
              },
              message: "Цена изменилась. Требуется новое согласие.",
            }
          : {
              kind: "applied",
              cart: {
                revision: 1,
                lines: [
                  {
                    productId: "c1",
                    warehouse: catalog[0].stocks[0].warehouse,
                    quantity: 5,
                    price: 500,
                  },
                ],
              },
            },
    });
  });
  await page.goto("/harness.html");
  await page
    .getByRole("button", { name: "Кабель ВВГнг-LS 3×2,5", exact: true })
    .click();
  await page.getByRole("button", { name: "В корзину", exact: true }).click();
  await page.getByRole("button", { name: "Да, добавить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Цена изменилась");
  await expect(page.locator(".cart-column .count")).toHaveText("0");
  await expect(page.locator(".proposal")).toContainText("500");
  expect(commits).toBe(1);
  await page.getByRole("button", { name: "Да, добавить", exact: true }).click();
  await expect(page.locator(".cart-column .cart-sum")).toContainText("2 500");
  expect(commits).toBe(2);
});
