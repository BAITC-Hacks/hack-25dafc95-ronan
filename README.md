# EKT Assistant — backend demo MVP

Backend HackAlem AI для каталога ekt.kz и отдельной демо-корзины. Frontend и Python `ml_core` разрабатываются другими участниками. Это не интеграция записи в корзину EKT.

## Рабочий путь

`GET /api/products?q=DEMO_001` → `GET /api/products/900000001` → `POST /api/session` → `POST /api/cart/proposals` → отдельный `POST /api/cart/proposals/:id/confirm` → `GET /api/cart` или `/cart` с той же cookie. Создание предложения не меняет корзину. Повтор того же confirm не добавляет товар дважды. Страница `/cart` — минимальная страница Node для проверки текущей демо-корзины до подключения frontend.

Демо-товар лежит отдельно в `samples/synthetic/demo-products.json` и помечен `source=synthetic`. Только у него заданы demo-единица, цена, остаток и правило количества. Исходный товар EKT 515291 нельзя добавить: неизвестны его подтверждённые правила продажи; API возвращает `PURCHASE_RULES_UNKNOWN`. `CART_MODE=ekt` возвращает 501 `INTEGRATION_NOT_CONFIGURED`.

Каталог сохраняет исходный JSON отдельно от нормализованных колонок PostgreSQL. Снимки в `samples/` не являются текущими данными EKT. У 515291 сохраняются `200300285_`, `027228`, опубликованные остатки 23 и 8 на raw-складе 24 и предупреждение `SPEC_CONFLICT` для 160 А / 250 А. У list-only товаров остаток `null`, а `count=20` не объявляется размером каталога. `RECOMMEND` не используется как список аналогов.

`POST /api/chat` — минимальный read-only путь. Node при заданном `ML_CORE_URL` вызывает Python по `docs/ML_CORE_CONTRACT.md` для разбора запроса и ранжирования ID. Node проверяет, что ID входят в выбранных кандидатов, и берёт карточки, цены и остатки только из каталога. При недоступном Python применяет локальный поиск; `GET /api/products` работает независимо. Python не получает cookie, CSRF token и право менять корзину. Фактический Python сервис в этой сессии не подключался; контракт с ML-участником пока черновой.

Публичные маршруты и JSON описаны в `docs/API_CONTRACT.md` и `/api/openapi.json`. Frontend-участник уже получил проект API-контракта; изменения MVP зафиксированы в документе для передачи команде. Код frontend не менялся.

## Локальный запуск без Docker

Нужны Node.js 24 LTS и PostgreSQL. Из корня репозитория:

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Укажите свои значения в .env; файл игнорируется Git.
npm run db:migrate
npm run db:seed-fixtures
npm run dev:api
```

Сервер слушает `http://localhost:8000`. Node автоматически читает корневой `.env`, если он есть. Для текущей локальной проверки использованы `CATALOG_MODE=fixture`, `CART_MODE=demo`, `AI_MODE=stub`, `PORT=8000` и `DATABASE_URL` для локальной базы `ekt_assistant`; пароль не помещён в репозиторий. Установить соединение можно через настроенный локальный PostgreSQL. Если ему нужен пароль, храните его только в `.env` или локальном хранилище секретов. `TEST_DATABASE_URL` нужен только для интеграционных тестов в отдельной БД. `ML_CORE_URL` необязателен. Реальные EKT credentials нужны только при `CATALOG_MODE=live` и не проверялись.

Для браузерных мутаций нужен `Origin` того же origin, session cookie из `POST /api/session` и `X-CSRF-Token` из его ответа. Confirm дополнительно требует уникальный `Idempotency-Key`. Session cookie имеет `HttpOnly`, `SameSite=Lax`, а в production — `Secure`. Frontend должен вызывать API через тот же origin или согласованный proxy. Не передавайте cookie/token в Python.

## Проверки

```powershell
npm run lint
npm run typecheck
npm test
npm run build
# Только с отдельной тестовой БД и TEST_DATABASE_URL:
npm run test:integration
```

На локальном PostgreSQL выполнены миграции 001/002 и загрузка fixtures в `ekt_assistant`: 20 товаров, одна detail-карточка. Через HTTP проверены поиск `027228`, карточка 515291, весь путь synthetic товара до демо-корзины, повтор confirm, страница `/cart` и чат при отключённом Python. На Node.js 24.21.0 прошли `npm ci --offline` (0 обнаруженных vulnerabilities), `npm run lint`, `npm run typecheck`, `npm test` (9 offline-тестов; 2 DB-теста пропущены без `TEST_DATABASE_URL`), `npm run build` и `npm run test:integration` (2 PostgreSQL-теста в отдельной `ekt_demo_mvp_test`).

Пример ключевых полей `GET /api/products/515291`:

```json
{
  "id": 515291,
  "article": "200300285_",
  "supplier_article": "027228",
  "price": { "amount": "64920", "currency": null, "currency_source": null },
  "stock": { "reported_total": "23", "selected_store_id": 24, "reported_store_quantity": "8", "sellable_quantity": null },
  "warnings": [{ "code": "SPEC_CONFLICT", "field": "nominal_current", "claims": [
    { "value": "160 А", "source": "name_and_description" },
    { "value": "250 А", "source": "properties.NOMINALNYY_TOK" }
  ] }],
  "provenance": { "source": "user_snapshot", "fetched_at": null, "catalog_complete": false },
  "cart_mode": "demo"
}
```

## Ограничения

Реальная корзина EKT заблокирована отсутствием контракта записи, связи с посетителем и гарантий идемпотентности. Не подтверждены единицы, продаваемые склады, валюта и правила цены EKT, условия доставки/оплаты, сертификаты, семантика `offers`/`RECOMMEND` и полнота каталога. Демо-корзина не резервирует товар. Для live EKT и Python `ml_core` пока нет проверенного smoke test; обычный каталог и demo flow работают автономно. Вложения, проверенные аналоги и полноценный AI-консультант остаются следующими этапами.
