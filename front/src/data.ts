import { applyConfirmed, emptyCart, quote } from "./cartEngine";
import { catalog } from "./catalog";
import type { Cart, DataSource, MutationResult } from "./types";
const storageKey = "ekt-demo-cart-v1";
function restore(): Cart {
  try {
    const c = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (
      !c ||
      !Number.isInteger(c.revision) ||
      c.revision < 0 ||
      !Array.isArray(c.lines)
    )
      return emptyCart();
    const seen = new Set<string>();
    for (const l of c.lines) {
      const p = catalog.find((p) => p.id === l.productId);
      const key = `${l.productId}|${l.warehouse}`;
      if (
        !p ||
        seen.has(key) ||
        !p.stocks.some((s) => s.warehouse === l.warehouse) ||
        !Number.isFinite(l.quantity) ||
        l.quantity < p.min ||
        Math.abs(l.quantity / p.step - Math.round(l.quantity / p.step)) >
          0.00001 ||
        !Number.isFinite(l.price) ||
        l.price < 0
      )
        return emptyCart();
      seen.add(key);
    }
    return c;
  } catch {
    return emptyCart();
  }
}
const delay = () => new Promise((resolve) => setTimeout(resolve, 420));
export function createDemoSource(): DataSource {
  let cart = restore();
  const results = new Map<string, MutationResult>();
  const save = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch {
      /* session remains usable */
    }
  };
  return {
    mode: "demo",
    cartUrl: "#/cart",
    async getCatalog() {
      return catalog;
    },
    async getCart() {
      return cart;
    },
    async chat(text) {
      await delay();
      const t = text.toLowerCase();
      if (t.includes("ошибка"))
        throw new Error(
          "Тестовый сетевой сбой. Нажмите «Повторить» или отправьте другой запрос.",
        );
      if (/оплат|достав|парти|условия/.test(t))
        return {
          text: "Демонстрационные условия: оплата — 100% предоплата; доставка — 1–3 рабочих дня, 2 000 ₸. Самовывоз — бесплатно. Для кабеля DEMO-1001 минимум 5 м, шаг 5 м; для остальных позиций партия указана в карточке. Это подготовленный пример, не условия ekt.kz.",
        };
      if (/аналог|ввг 3|demo-1000/.test(t))
        return {
          text: "Кабеля ВВГ 3×2,5 (DEMO-1000) нет в наличии. Подготовленный пример альтернативы — ВВГнг-LS 3×2,5. Проверьте требования проекта перед заменой.",
          products: [catalog[3], catalog[0]],
          analog: {
            reason:
              "Та же медная жила, сечение и номинальное напряжение; отличается исполнение оболочки.",
            matches: ["3 × 2,5 мм²", "Медь", "0,66 кВ"],
            differences: [
              "Оболочка нг-LS вместо ПВХ",
              "Цена 485 вместо 450 ₸/м",
              "Совместимость требует проверки специалистом",
            ],
          },
        };
      if (/каталог|все товары/.test(t))
        return {
          text: "В демонстрационном каталоге 10 синтетических позиций. Выберите товар и склад; добавление потребует отдельного подтверждения.",
          products: catalog,
        };
      const found = catalog.filter(
        (p) =>
          t.includes(p.sku.toLowerCase()) ||
          (t.includes("кабел") && p.id === "c1") ||
          (t.includes("автомат") && p.id === "b1") ||
          (t.includes("узо") && p.id === "b2") ||
          (t.includes("лент") && p.id === "k3") ||
          (t.includes("светильник") && p.id === "l1") ||
          (t.includes("прожектор") && p.id === "l2") ||
          (t.includes("клемм") && p.id === "k1") ||
          (t.includes("провод") && p.id === "c2"),
      );
      return found.length
        ? {
            text: "Вот данные из тестового каталога. Цена указана за единицу продажи; остатки относятся к отдельным складам.",
            products: found,
          }
        : {
            text: "Для этого запроса нет подготовленного демосценария. Здесь не подключена языковая модель. Попробуйте «Кабель», «Аналог ВВГ 3×2,5», «Условия доставки» или артикул DEMO-2002.",
            products: [],
          };
    },
    async propose(intent) {
      const p = catalog.find((p) => p.id === intent.productId);
      if (!p) throw new Error("Товар не найден.");
      return quote(cart, p, intent);
    },
    async commit(proposal) {
      await delay();
      const prior = results.get(proposal.id);
      if (prior) return prior;
      const p = catalog.find((p) => p.id === proposal.product.id)!;
      const result = applyConfirmed(cart, p, proposal, true);
      cart = result.cart;
      results.set(proposal.id, result);
      save();
      return result;
    },
    async reconcile(id) {
      return {
        status: results.get(id)?.kind === "applied" ? "applied" : "not-applied",
        cart,
      };
    },
    async reset() {
      cart = emptyCart();
      results.clear();
      save();
      return cart;
    },
  };
}
/** Supply a team-owned adapter here. No fallback to demo is permitted in API mode. */
export function createApiSource(): DataSource {
  const unavailable = async (): Promise<never> => {
    throw new Error(
      "API не настроен. Команда должна предоставить адаптер, механизм авторизации и адрес корзины.",
    );
  };
  return {
    mode: "api",
    cartUrl: "",
    getCatalog: unavailable,
    getCart: unavailable,
    chat: unavailable,
    propose: unavailable,
    commit: unavailable,
    reconcile: unavailable,
  };
}
