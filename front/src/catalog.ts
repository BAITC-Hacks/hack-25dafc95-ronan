import type { Product } from "./types";
const product = (
  id: string,
  sku: string,
  name: string,
  price: number | null,
  unit: string,
  icon: Product["icon"],
  quantity: number | null,
  specs: Record<string, string>,
  extras: Partial<Product> = {},
): Product => ({
  id,
  sku,
  name,
  price,
  unit,
  icon,
  category:
    icon === "cable"
      ? "Кабель и провод"
      : icon === "breaker"
        ? "Модульное оборудование"
        : icon === "light"
          ? "Освещение"
          : "Монтаж и аксессуары",
  min: 1,
  step: 1,
  stocks: [{ warehouse: "Алматы · демосклад", quantity }],
  specs,
  certificate: null,
  ...extras,
});
export const catalog: Product[] = [
  product(
    "c1",
    "DEMO-1001",
    "Кабель ВВГнг-LS 3×2,5",
    485,
    "м",
    "cable",
    120,
    {
      Сечение: "3 × 2,5 мм²",
      Жила: "Медь",
      Напряжение: "0,66 кВ",
      Оболочка: "нг-LS",
    },
    {
      min: 5,
      step: 5,
      stocks: [
        { warehouse: "Алматы · демосклад", quantity: 120 },
        { warehouse: "Астана · демосклад", quantity: 45 },
      ],
      certificate: {
        name: "Тестовый паспорт · HTML",
        url: "./demo-certificate.html",
      },
    },
  ),
  product(
    "b1",
    "DEMO-2001",
    "Автоматический выключатель C16",
    2450,
    "шт",
    "breaker",
    32,
    { Полюса: "1P", Ток: "16 А", Характеристика: "C", Отключение: "6 кА" },
  ),
  product("l1", "DEMO-3001", "Светильник LED 36 Вт", 6900, "шт", "light", 18, {
    Мощность: "36 Вт",
    Свет: "4000 К",
    Защита: "IP40",
  }),
  product(
    "c0",
    "DEMO-1000",
    "Кабель ВВГ 3×2,5",
    450,
    "м",
    "cable",
    0,
    {
      Сечение: "3 × 2,5 мм²",
      Жила: "Медь",
      Напряжение: "0,66 кВ",
      Оболочка: "ПВХ",
    },
    { min: 5, step: 5 },
  ),
  product("b2", "DEMO-2002", "УЗО 2P 40 А / 30 мА", 12500, "шт", "breaker", 3, {
    Полюса: "2P",
    Ток: "40 А",
    Утечка: "30 мА",
  }),
  product(
    "k1",
    "DEMO-4001",
    "Клеммы соединительные, 10 шт",
    1800,
    "упак",
    "box",
    24,
    { "В упаковке": "10 шт", Сечение: "0,5–2,5 мм²" },
  ),
  product(
    "c2",
    "DEMO-1002",
    "Провод ПВ-3 1×1,5",
    175,
    "м",
    "cable",
    200,
    { Сечение: "1 × 1,5 мм²", Жила: "Медь, гибкая" },
    { min: 10, step: 10 },
  ),
  product("k2", "DEMO-4002", "Кабель-канал 25×16, 2 м", 780, "шт", "box", 40, {
    Размер: "25 × 16 мм",
    Длина: "2 м",
    Материал: "ПВХ",
  }),
  product("l2", "DEMO-3002", "Прожектор LED 50 Вт", null, "шт", "light", null, {
    Мощность: "50 Вт",
    Защита: "IP65",
  }),
  product(
    "k3",
    "DEMO-4003",
    "Лента монтажная",
    1200,
    "кг",
    "box",
    5,
    { Материал: "Оцинкованная сталь" },
    { min: 0.5, step: 0.5 },
  ),
];
