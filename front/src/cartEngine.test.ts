import { describe, expect, it } from "vitest";
import { applyConfirmed, emptyCart, exactConsent, quote } from "./cartEngine";
import { catalog } from "./catalog";
import { createDemoSource } from "./data";
const p = catalog[0];
const intent = {
  kind: "add" as const,
  productId: p.id,
  warehouse: p.stocks[0].warehouse,
  quantity: 10,
};
describe("explicit cart consent", () => {
  it("quoting is pure and absence of consent cannot change cart", () => {
    const c = emptyCart();
    const q = quote(c, p, intent);
    expect(c.lines).toHaveLength(0);
    expect(() => applyConfirmed(c, p, q, false)).toThrow();
    expect(c.lines).toHaveLength(0);
  });
  it("cancelled and completed proposals cannot execute", () => {
    const c = emptyCart();
    const q = quote(c, p, intent);
    for (const status of [
      "cancelled",
      "done",
      "pending",
      "superseded",
    ] as const)
      expect(() => applyConfirmed(c, p, { ...q, status }, true)).toThrow();
  });
  it("validates total stock including cart on chosen warehouse", () => {
    const c = {
      revision: 1,
      lines: [{ ...intent, quantity: 115, price: 485 }],
    };
    expect(() => quote(c, p, intent)).toThrow(/Уже в корзине: 115/);
    expect(quote(c, p, { ...intent, quantity: 5 }).after).toBe(120);
    expect(() =>
      quote(c, p, {
        ...intent,
        warehouse: p.stocks[1].warehouse,
        quantity: 50,
      }),
    ).toThrow();
  });
  it("returns a new proposal after price, stock or cart revision changes", () => {
    const c = emptyCart();
    const q = quote(c, p, intent);
    for (const modified of [
      { ...p, price: 500 },
      { ...p, stocks: [{ ...p.stocks[0], quantity: 110 }] },
    ]) {
      const result = applyConfirmed(c, modified, q, true);
      expect(result.kind).toBe("changed");
      expect(result.cart.lines).toHaveLength(0);
    }
    expect(applyConfirmed({ ...c, revision: 2 }, p, q, true).kind).toBe(
      "changed",
    );
  });
  it("does not silently reduce quantity when stock shrinks", () => {
    const c = emptyCart();
    expect(() =>
      applyConfirmed(
        c,
        { ...p, stocks: [{ ...p.stocks[0], quantity: 5 }] },
        quote(c, p, intent),
        true,
      ),
    ).toThrow();
    expect(c.lines).toHaveLength(0);
  });
  it("requires min and steps including fractional units", () => {
    expect(() => quote(emptyCart(), p, { ...intent, quantity: 3 })).toThrow();
    const fractional = catalog[9];
    expect(
      quote(emptyCart(), fractional, {
        ...intent,
        productId: fractional.id,
        quantity: 0.5,
      }).after,
    ).toBe(0.5);
    expect(() =>
      quote(emptyCart(), fractional, { ...intent, quantity: 0.3 }),
    ).toThrow();
  });
  it("does not interpret incidental да as consent", () => {
    for (const s of [
      "доставка",
      "давай аналоги",
      "не надо, да",
      "да добавь и удали кабель",
      "когда",
    ])
      expect(exactConsent(s)).toBe(false);
    expect(exactConsent("Да, добавь!")).toBe(true);
  });
  it("unknown price and stock block proposals", () => {
    expect(() =>
      quote(emptyCart(), catalog[8], { ...intent, productId: catalog[8].id }),
    ).toThrow(/неизвестны/);
  });
  it("replaying an operation id returns the same cart, never adds twice", async () => {
    const source = createDemoSource();
    await source.reset!();
    const q = await source.propose(intent);
    const first = await source.commit(q);
    const second = await source.commit(q);
    expect(second).toEqual(first);
    expect((await source.getCart()).lines[0].quantity).toBe(10);
    expect((await source.reconcile(q.id)).status).toBe("applied");
  });
  it("quantity update and removal both need confirmation", () => {
    const c = {
      revision: 1,
      lines: [
        {
          productId: p.id,
          warehouse: intent.warehouse,
          quantity: 10,
          price: 485,
        },
      ],
    };
    for (const kind of ["set", "remove"] as const) {
      const q = quote(c, p, { ...intent, kind, quantity: 5 });
      expect(() => applyConfirmed(c, p, q, false)).toThrow();
      expect(c.lines[0].quantity).toBe(10);
      expect(applyConfirmed(c, p, q, true).kind).toBe("applied");
    }
  });
});
