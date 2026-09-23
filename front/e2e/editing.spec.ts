import { test, expect } from "@playwright/test";
test("quantity and removal each require the matching explicit consent", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Кабель ВВГнг-LS 3×2,5", exact: true })
    .click();
  await page.getByRole("button", { name: "В корзину", exact: true }).click();
  await page.getByRole("button", { name: "Да, добавить", exact: true }).click();
  const quantity = page.locator(".cart-column .line-controls input");
  await expect(quantity).toHaveValue("5");
  await quantity.fill("10");
  await page
    .getByRole("button", { name: "Подтвердить новое количество" })
    .click();
  await expect(page.locator(".cart-column .cart-sum")).toContainText("2 425");
  const input = page.getByRole("textbox", { name: "Сообщение помощнику" });
  await input.fill("да, добавь");
  await input.press("Enter");
  await expect(page.locator(".message").last()).toContainText(
    "Фраза «добавь» его не подтверждает",
  );
  await page.getByRole("button", { name: "Да, изменить", exact: true }).click();
  await expect(page.locator(".cart-column .cart-sum")).toContainText("4 850");
  await page
    .getByRole("button", { name: "Удалить Кабель ВВГнг-LS 3×2,5" })
    .click();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(page.locator(".cart-column .count")).toHaveText("1");
  await page
    .getByRole("button", { name: "Удалить Кабель ВВГнг-LS 3×2,5" })
    .click();
  await page.getByRole("button", { name: "Да, удалить", exact: true }).click();
  await expect(page.locator(".cart-column .count")).toHaveText("0");
});
test("IME does not send; small viewport keeps composer visible; oversized file rejected", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Сообщение помощнику" });
  await input.fill("кабель");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await expect(page.locator(".message.user")).toHaveCount(0);
  await expect(input).toHaveValue("кабель");
  const box = await page
    .getByRole("button", { name: "Отправить сообщение" })
    .boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(480);
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "large.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    });
  await expect(page.getByRole("alert")).toContainText("до 10 МБ");
  await page.getByRole("button", { name: "Закрыть помощника" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Кабель ВВГнг-LS 3×2,5", exact: true }),
  ).toBeFocused();
});
