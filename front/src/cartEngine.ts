import type { Cart, Intent, MutationResult, Product, Proposal } from "./types";
export const emptyCart = (): Cart => ({ revision: 0, lines: [] });
export const keyOf = (x: { productId: string; warehouse: string }) =>
  `${x.productId}|${x.warehouse}`;
export function quote(
  cart: Cart,
  product: Product,
  intent: Intent,
  id = crypto.randomUUID(),
): Proposal {
  const before =
    cart.lines.find((l) => keyOf(l) === keyOf(intent))?.quantity ?? 0;
  const after =
    intent.kind === "remove"
      ? 0
      : intent.kind === "add"
        ? before + intent.quantity
        : intent.quantity;
  const available = product.stocks.find(
    (s) => s.warehouse === intent.warehouse,
  )?.quantity;
  if (product.price === null || available == null)
    throw new Error(
      "Цена или остаток неизвестны. Изменение корзины недоступно.",
    );
  if (
    intent.kind !== "remove" &&
    (!Number.isFinite(intent.quantity) ||
      intent.quantity <= 0 ||
      after < product.min ||
      Math.abs(after / product.step - Math.round(after / product.step)) >
        0.00001)
  )
    throw new Error(
      `Минимум ${product.min} ${product.unit}, шаг ${product.step} ${product.unit}.`,
    );
  if (after > available && intent.kind !== "remove")
    throw new Error(
      `На выбранном складе ${available} ${product.unit}. Уже в корзине: ${before} ${product.unit}. Количество не изменено.`,
    );
  if (after === before)
    throw new Error("Количество уже такое же. Изменение не требуется.");
  return {
    id,
    intent,
    product,
    before,
    after,
    price: product.price,
    available,
    revision: cart.revision,
    status: "active",
  };
}
export function applyConfirmed(
  cart: Cart,
  currentProduct: Product,
  proposal: Proposal,
  consent: boolean,
): MutationResult {
  if (!consent || proposal.status !== "active")
    throw new Error("Нет действующего подтверждения.");
  const fresh = quote(cart, currentProduct, proposal.intent);
  if (
    fresh.price !== proposal.price ||
    fresh.available !== proposal.available ||
    fresh.revision !== proposal.revision ||
    fresh.before !== proposal.before
  )
    return {
      kind: "changed",
      cart,
      proposal: fresh,
      message:
        "Условия изменились. Проверьте новый состав операции и подтвердите его ещё раз.",
    };
  const lines = cart.lines.filter((l) => keyOf(l) !== keyOf(proposal.intent));
  if (proposal.after > 0)
    lines.push({
      productId: currentProduct.id,
      warehouse: proposal.intent.warehouse,
      quantity: proposal.after,
      price: proposal.price,
    });
  return { kind: "applied", cart: { revision: cart.revision + 1, lines } };
}
export function exactConsent(text: string): boolean {
  return /^(да|да,? добавь|да,? добавить|да,? подтверждаю)[.!]?$/iu.test(
    text.trim(),
  );
}
