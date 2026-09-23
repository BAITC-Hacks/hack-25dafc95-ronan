# EKT Assistant — backend demo MVP

Демо-MVP HackAlem AI: Node backend для каталога и отдельной демо-корзины, React frontend команды и локальный Python `ml_core` для ранжирования. Это не интеграция записи в корзину EKT.

## Рабочий путь

`GET /api/products?q=DEMO_001` → `GET /api/products/900000001` → `POST /api/session` → `POST /api/cart/proposals` → отдельный `POST /api/cart/proposals/:id/confirm` → `GET /api/cart` или frontend `/#/cart` с той же cookie. Создание предложения не меняет корзину. Повтор того же confirm не добавляет товар дважды. Node `/cart` остаётся простой проверочной страницей той же демо-корзины.

Демо-товар лежит отдельно в `samples/synthetic/demo-products.json` и помечен `source=synthetic`. Только у него заданы demo-единица, цена, остаток и правило количества. Исходный товар EKT 515291 нельзя добавить: неизвестны его подтверждённые правила продажи; API возвращает `PURCHASE_RULES_UNKNOWN`. `CART_MODE=ekt` возвращает 501 `INTEGRATION_NOT_CONFIGURED`.

Каталог сохраняет исходный JSON отдельно от нормализованных колонок PostgreSQL. Снимки в `samples/` не являются текущими данными EKT. У 515291 сохраняются `200300285_`, `027228`, опубликованные остатки 23 и 8 на raw-складе 24 и предупреждение `SPEC_CONFLICT` для 160 А / 250 А. У list-only товаров остаток `null`, а `count=20` не объявляется размером каталога. `RECOMMEND` не используется как список аналогов.

`POST /api/chat` — минимальный read-only путь. Node при заданном `ML_CORE_URL` вызывает Python HTTP-адаптер по `docs/ML_CORE_CONTRACT.md` для разбора запроса и ранжирования ID. Node проверяет, что ID входят в выбранных кандидатов, и берёт карточки, цены и остатки только из каталога. При недоступном Python применяет локальный поиск; `GET /api/products` работает независимо. Python не получает cookie, CSRF token и право менять корзину. Локальный вызов проверен; командное согласование границы с ML-участником остаётся открытым.

Публичные маршруты и JSON описаны в `docs/API_CONTRACT.md` и `/api/openapi.json`. API-адаптер frontend подключён без изменения дизайна и локального демо-режима. API-режим выбирается в верхней полосе, открывает корзину по `/#/cart` и сохраняется в пределах вкладки после обновления страницы.

## Локальный запуск без Docker

Нужны Node.js 24 LTS, Python 3.12+ и PostgreSQL. Из корня репозитория:

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Укажите свои значения в .env; файл игнорируется Git.
npm run db:migrate
npm run db:seed-fixtures
npm run dev:api
```

В отдельном терминале для Python: `python -m pip install -r requirements.txt`, затем `python -m ml_core.service`. В `.env` Node задайте `ML_CORE_URL=http://127.0.0.1:8100`. Для frontend выполните `cd front`, `npm ci`, `npm run dev` или `npm run build` и `npm run preview`. Для локального Vite proxy добавьте в корневой `.env` `ALLOWED_ORIGIN=http://127.0.0.1:5173`; откройте `http://127.0.0.1:5173` и выберите режим `API`. Все значения `.env` локальны; файл игнорируется Git.

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

На локальном PostgreSQL выполнены миграции 001/002 и загрузка fixtures в `ekt_assistant`: 20 товаров, одна detail-карточка. Через HTTP проверены поиск `027228`, карточка 515291, чат с Python (`ml_status=ok`) и `SPEC_CONFLICT`. На Node.js 24.21.0 прошли `npm run lint`, `npm run typecheck`, `npm test` (10 offline-тестов; 2 DB-теста пропущены без `TEST_DATABASE_URL`), `npm run build` и `npm run test:integration` (2 PostgreSQL-теста в отдельной `ekt_demo_mvp_test`). Python `pytest`: 9 тестов. Frontend: `npm test` (10 тестов), `npm run build` (включает TypeScript), Playwright demo suite — 9 пройдено, API-тест пропущен без `E2E_API`. Отдельный `front/e2e/api-integration.spec.ts` прошёл с реальными Node, Python, PostgreSQL и Chromium: поиск → карточка → предложение (корзина ещё пуста) → confirm → `/#/cart` → обновление той же страницы. В frontend нет отдельного lint script; production-сборка проверяет TypeScript.

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

Реальная корзина EKT заблокирована отсутствием контракта записи, связи с посетителем и гарантий идемпотентности. Не подтверждены единицы, продаваемые склады, валюта и правила цены EKT, условия доставки/оплаты, сертификаты, семантика `offers`/`RECOMMEND` и полнота каталога. Демо-корзина не резервирует товар. Live EKT не проверялся; Python HTTP-слой проверен локально, но требует согласования с ML-участником. Вложения, проверенные аналоги и полноценный AI-консультант остаются следующими этапами.
