import { test, expect } from "@playwright/test";
test("five must-haves: product, analog, terms, consent, persistent cart", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Кабель ВВГнг-LS 3×2,5", exact: true })
    .click();
  const card = page.locator(".product-card").first();
  await expect(card).toContainText("В наличии: 120 м");
  await expect(card).toContainText("0,66 кВ");
  const certificate = await card
    .getByRole("link", { name: /Тестовый паспорт/ })
    .getAttribute("href");
  expect(
    (await page.request.get("/" + certificate!.replace("./", ""))).status(),
  ).toBe(200);
  await card.getByRole("button", { name: "В корзину", exact: true }).click();
  await expect(page.locator(".cart-column .count")).toHaveText("0");
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Да, добавить", exact: true }),
  ).toBeDisabled();
  await card.getByRole("button", { name: "В корзину", exact: true }).click();
  await page
    .getByRole("button", { name: "Да, добавить", exact: true })
    .dblclick();
  await expect(page.locator(".cart-column .count")).toHaveText("1");
  await expect(page.locator(".cart-column .cart-sum")).toContainText("2 425");
  await expect(page.locator(".cart-column .line-controls input")).toHaveValue(
    "5",
  );
  await card.getByLabel("Количество DEMO-1001").fill("120");
  await card.getByRole("button", { name: "В корзину", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Уже в корзине: 5");
  await page
    .getByRole("button", { name: "Аналог ВВГ 3×2,5", exact: true })
    .click();
  await expect(page.locator(".analog-box")).toContainText(
    "Совместимость требует проверки",
  );
  await page
    .getByRole("button", { name: "Условия доставки", exact: true })
    .click();
  await expect(page.locator(".message").last()).toContainText(
    "100% предоплата",
  );
  await page.getByRole("link", { name: "Открыть актуальную корзину" }).click();
  await expect(page).toHaveURL(/#\/cart$/);
  await page.reload();
  await expect(page.locator(".cart-line h4")).toHaveText(
    "Кабель ВВГнг-LS 3×2,5",
  );
  await expect(page.locator(".cart-sum")).toContainText("2 425");
  await page.screenshot({ path: "qa/cart-desktop.png", fullPage: true });
});
test("retry without duplicated user message, unknown query, attachments and API failure", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Сообщение помощнику" });
  await input.fill("ошибка");
  await input.press("Enter");
  await page.getByRole("button", { name: "Повторить запрос" }).click();
  await expect(
    page.getByRole("button", { name: "Повторить запрос" }),
  ).toBeVisible();
  await expect(page.locator(".message.user")).toHaveCount(1);
  await input.fill("неизвестный сценарий");
  await input.press("Enter");
  await expect(page.locator(".message").last()).toContainText(
    "нет подготовленного демосценария",
  );
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("test"),
  });
  await expect(page.getByRole("alert")).toContainText("Допустимы Excel");
  await page.locator("input[type=file]").setInputFiles({
    name: "spec.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("demo document"),
  });
  await expect(page.locator(".attachment")).toContainText("spec.pdf");
  await page.getByRole("button", { name: "Убрать вложение" }).click();
  await expect(page.locator(".attachment")).toHaveCount(0);
  await page.locator("input[type=file]").setInputFiles({
    name: "spec.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("demo document"),
  });
  await page.getByRole("button", { name: "Отправить сообщение" }).click();
  await expect(page.locator(".message").last()).toContainText(
    "Содержимое вашего файла не использовалось",
  );
  await page.getByLabel("Источник данных").selectOption("api");
  await expect(page.getByRole("alert")).toContainText("API не настроен");
  await expect(page.locator(".product-card")).toHaveCount(0);
});
test("mobile panel, focus, cancellation, exact text consent and keyboard newline", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.screenshot({ path: "qa/mobile.png", fullPage: false });
  await page.getByRole("button", { name: "Открыть панель корзины" }).click();
  await expect(
    page.getByRole("button", { name: "Вернуться в чат" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("textbox", { name: "Сообщение помощнику" }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Кабель ВВГнг-LS 3×2,5", exact: true })
    .click();
  await page.getByRole("button", { name: "В корзину", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Сообщение помощнику" });
  await input.fill("когда доставка");
  await input.press("Enter");
  await expect(page.locator(".message").last()).toContainText(
    "Демонстрационные условия",
  );
  await expect(
    page.getByRole("button", { name: "Да, добавить", exact: true }),
  ).toBeEnabled();
  await input.fill("да, добавь");
  await input.press("Enter");
  await expect(page.locator(".success-link")).toBeVisible();
  await input.fill("строка");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("строка\n");
  await input.fill("");
  await page.getByRole("button", { name: "Открыть панель корзины" }).click();
  await expect(page.locator(".cart-column .count")).toHaveText("1");
  await page.screenshot({ path: "qa/mobile-cart.png", fullPage: false });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Спросить помощника" }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("desktop visual and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Кабель ВВГнг-LS 3×2,5", exact: true })
    .waitFor();
  await page.screenshot({ path: "qa/desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});
