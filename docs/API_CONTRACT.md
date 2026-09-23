# API-контракт команды — интегрированный demo MVP v0.3

## Реализованный HTTP-контракт

Реализованы `GET /api/health`, `GET /api/products` (с необязательным `q`), `GET /api/products/:id`,
`POST /api/session`, `GET /api/cart`, `POST /api/cart/proposals`,
`POST /api/cart/proposals/:id/confirm`, `GET /api/cart/proposals/:id/status`, `POST /api/cart/proposals/:id/cancel`,
`GET /cart`, `POST /api/chat` и `GET /api/openapi.json`. Остальные маршруты в
таблице ниже остаются проектом следующих этапов.

Поиск возвращает `{ "items": [{ "product": ..., "match": "exact_identifier|name|visible_page" }],
"coverage": { "complete": false, "inspected_pages": [2], "reported_count": 20,
"note": "..." } }` в fixture-режиме. В live-режиме просматривается только текущая
первая страница EKT. Без `q` возвращается просмотренная страница и synthetic-товар с `match=visible_page`; это не полный каталог. Пустой `items` не утверждает отсутствие товара в магазине.

Поиск и `/api/chat` проверяют тип товара и заданный ток по исходному запросу. Бренд `Legrand` не считается артикулом; запрос 160 А не расширяется до товаров 80 А. Для снимков одного названия недостаточно, чтобы подтвердить ток: при отсутствии данных или противоречии характеристик подходящее техническое совпадение не заявляется. Точные идентификаторы `027228`, `200300285_`, `DEMO_001` сохраняются строками. Карточка 515291 доступна по точному идентификатору с `SPEC_CONFLICT`, но не используется как уверенное совпадение по току.

Карточка добавляет `cart_mode`, `detail_available`, `barcode` и
`provenance.field_sources`. `price.currency` и `price.currency_source` пока `null`:
валюта отсутствует в исходном JSON. Значения `stock.reported_total` и
`reported_store_quantity` могут быть `null`, когда detail или складские данные
не получены. `sellable_quantity` всегда `null`, пока правила продажи не
подтверждены. Эти поля следует считать фактическим контрактом этапа 1;
машинная схема доступна в `/api/openapi.json`. В fixture-режиме поиск также
показывает отдельный synthetic товар `900000001` с `provenance.source=synthetic`.
Он предназначен только для проверки демо-корзины и не является товаром EKT.

Для всех изменяющих корзину запросов нужен `Origin`, совпадающий с адресом
API (либо настроенным `ALLOWED_ORIGIN`), session cookie и `X-CSRF-Token`.
`POST /api/session` требует `Origin`, создаёт/обновляет cookie
`ekt_demo_session` (`HttpOnly`, `SameSite=Lax`, `Secure` в production) и
возвращает `{ "csrf_token": "...", "cart_mode": "demo", "expires_in_seconds": 86400 }`.
Значение cookie и token нельзя передавать в Python или сохранять в frontend bundle.

Повторный bootstrap той же cookie обновляет CSRF-токен. При `CSRF_INVALID` frontend допускает ровно один повтор мутации после нового `POST /api/session`: путь, тело и `Idempotency-Key` confirm остаются прежними. На сетевые ошибки, другие коды или второй CSRF-отказ автоматического повтора нет. Это поддерживает две вкладки общей сессии, сохраняя проверки CSRF и Origin.

`GET /api/cart` возвращает только корзину текущей cookie:

```json
{
  "version": 0,
  "items": [],
  "total": { "amount": "0", "currency": "KZT" },
  "cart_mode": "demo"
}
```

`POST /api/cart/proposals` принимает `{ "items": [{ "product_id": 900000001,
"store_id": 24, "quantity": "2" }] }`. Пока правила продажи исходных товаров
EKT неизвестны, только явно synthetic товар имеет право попасть в demo proposal.
Для 515291 сервер возвращает `PURCHASE_RULES_UNKNOWN`. Успешный ответ содержит
`proposal_id`, `version: 1`, `expires_at`, `cart_version`, неизменяемые `items`
с ценой/единицей/источником, `total`, `source: synthetic`, `cart_mode: demo`,
`status: active`. Корзина при создании proposal не меняется.

`POST /api/cart/proposals/:id/confirm` требует `Idempotency-Key` длиной 8–128
символов и тело `{ "proposal_version": 1 }`. Сервер повторно читает цену,
остаток и правила synthetic товара, проверяет версию корзины и уже лежащее
количество. Успех возвращает `{ "cart": ..., "cart_mode": "demo",
"stock_source": "synthetic", "cart_url": "/cart" }`. `/cart` сейчас
обслуживает минимальная страница Node для той же cookie. Повтор с тем же ключом
и телом возвращает сохранённый ответ; другой ключ для consumed proposal не
добавляет товар. `POST /api/cart/proposals/:id/cancel` отменяет active proposal.
Успешный cancel возвращает `{ "status": "cancelled", "cart_mode": "demo" }`; кнопка «Отмена» объявляет успех только после этого ответа. Отменённое предложение нельзя подтвердить, корзина при отмене не меняется.
`GET /api/cart/proposals/:id/status` доступен только владельцу session cookie и
возвращает `{ "status": "applied|not-applied|unknown", "cart": ..., "cart_mode": "demo" }` для сверки после неопределённого ответа confirm.
При `CART_MODE=ekt` маршруты корзины возвращают 501
`INTEGRATION_NOT_CONFIGURED`.

`POST /api/chat` принимает `{ "message": "Есть 027228 в Астане?", "locale": "ru" }`
и необязательные `context` и пустой `attachment_ids`. Ответ: `answer`,
`products` (карточки Node), `ml_status: ok|unavailable|disabled`,
`llm_status: ok|unavailable|disabled`, `cart_mode`,
`catalog_complete: false`. Это read-only путь: он не создаёт предложение и не
подтверждает корзину. Node вызывает Python по черновому контракту
`docs/ML_CORE_CONTRACT.md`, если задан `ML_CORE_URL`; при сбое Python применяет
локальный поиск. Локальный Python HTTP-адаптер реализован и проверен; командное
согласование контракта с ML-участником остаётся открытым.

Python возвращает рекомендации ранжирования, а Node повторно проверяет допустимость кандидатов по исходному сообщению и каталогу. Усечённая `query` Python не заменяет ограничения исходного запроса; fallback использует те же проверки. `ml_status=ok` означает успешный валидный HTTP-ответ локального Python с регулярными выражениями и строковым ранжированием, не работу LLM.

При `AI_MODE=openai` Node после проверки товаров вызывает OpenAI Responses API с `OPENAI_API_KEY` и `OPENAI_MODEL` из серверного окружения. Модель формулирует только `answer`, получает нормализованные карточки и не имеет инструментов корзины. Массив `products` строит Node независимо. При таймауте или ошибке возвращается шаблонный ответ и `llm_status=unavailable`; при `stub` — `disabled`. Ключ не передаётся frontend или Python.

Frontend API-режим вызывает `/api/products`, `/api/products/:id`, `/api/chat`,
`/api/session`, `/api/cart`, proposal, confirm и cancel с cookie одного origin через Vite proxy.
После confirm открывает `/#/cart` и повторно читает ту же серверную корзину при
обновлении страницы. Для proxy на `127.0.0.1:5173` у Node задаётся
`ALLOWED_ORIGIN=http://127.0.0.1:5173`. Режим `api` хранится только в
`sessionStorage`; session cookie остаётся HttpOnly, CSRF-токен — только в памяти JS.
Команды frontend `dev` и `preview` обе запускаются строго на `127.0.0.1:5173`; при занятом порте завершаются ошибкой вместо перехода на другой origin.

**Не документация существующего сервера EKT.** Маршруты этого документа принадлежат нашему backend. Нереализованные пункты ниже обозначены как проект следующих этапов.

## Общие правила

Префикс `/api`. Текущая сессия определяется серверной cookie, а не произвольным `session_id` из тела. Cookie: HttpOnly; Secure в HTTPS production; SameSite=Lax для same-site развертывания. Предпочтительный MVP — frontend и API на одном origin через proxy.

В изменяющих запросах проверять `Origin` и `X-CSRF-Token`; session bootstrap также требует проверки origin и ограничений частоты. CORS с credentials допускает только конкретные разрешённые origins, не `*`.

Количество — десятичная строка с документированной единицей; не терять дробные метры или ведущие нули артикулов. Деньги — десятичная строка, арифметика Decimal/PostgreSQL NUMERIC, валюта из конфигурации с указанием происхождения. В примере upstream поля currency нет.

Общая ошибка:

```json
{
  "error": {
    "code": "PRICE_CHANGED",
    "message": "Цена изменилась. Подтвердите новое предложение.",
    "request_id": "opaque-request-id",
    "retryable": false
  }
}
```

Никогда не включать в публичную ошибку Basic Auth, stack trace, cookies, SQL или внутренний ответ провайдера с секретами.

## Минимальные маршруты

| Метод и путь | Назначение | Кто вызывает |
|---|---|---|
| `GET /api/health` | Liveness, версия API без секретов | инфраструктура |
| `GET /api/ready` | Готовность БД и обязательных модулей | инфраструктура |
| `POST /api/session` | Создать/получить собственную анонимную сессию и CSRF token | frontend |
| `GET /api/products?q=027228` или без `q` | Поиск или просмотр доступной страницы | frontend / chat tools |
| `GET /api/products/:id` | Карточка с фактами, источниками и предупреждениями | frontend / chat tools |
| `GET /api/products/:id/alternatives` | Проверенные кандидаты и причины/ограничения | frontend / chat tools |
| `GET /api/policies?topic=delivery` | Утверждённые условия или отсутствие источника | frontend / chat tools |
| `POST /api/chat` | Сообщение текущей сессии | frontend |
| `GET /api/cart` | Только корзина текущей сессии | frontend / read-only tool |
| `POST /api/cart/proposals` | Создать неизменяемое предложение, не меняя корзину | frontend / propose tool |
| `POST /api/cart/proposals/:id/confirm` | Отдельное явное подтверждение владельца | пользователь через UI / серверный обработчик подтверждения |
| `GET /api/cart/proposals/:id/status` | Сверка результата после неопределённого ответа confirm | frontend |
| `POST /api/cart/proposals/:id/cancel` | Отменить предложение без изменения корзины | пользователь |
| `POST /api/attachments` | Загрузить разрешённый файл своей сессии | frontend, поздний этап |
| `GET /api/attachments/:id` | Статус обработки и извлечённые позиции владельца | frontend, поздний этап |

Полный каталог EKT синхронизируется служебной CLI-командой. Не открывать незащищённый публичный endpoint массового импорта.

## Сообщение чата

```json
{
  "message": "Есть 027228 в Астане?",
  "locale": "ru",
  "context": {"product_id": 515291, "store_id": 24},
  "attachment_ids": []
}
```

`context` — подсказка, не доверенный источник товара, склада, цены или прав доступа. Историю сообщений, роли system/tool и состояние подтверждения нельзя принимать от клиента. Владелец каждого attachment проверяется сервером. Поддерживаемые locale зависят от фактически реализованных возможностей; казахский не обещать до проверки.

## Карточка на исходном снимке

Ниже пример проектной нормализованной схемы, а не новый ответ API партнёра:

```json
{
  "id": 515291,
  "article": "200300285_",
  "supplier_article": "027228",
  "name": "027228 АВ DRX250 MT 3ф 160А 18ka Legrand (1)",
  "price": {"amount": "64920", "currency": "KZT", "currency_source": "demo_configuration"},
  "stock": {
    "reported_total": "23",
    "selected_store_id": 24,
    "selected_store_raw_name": "Нур-Султан",
    "selected_store_display_name": "Астана",
    "reported_store_quantity": "8",
    "sellable_quantity": null
  },
  "purchase_rules": null,
  "certificates": [],
  "warnings": [{
    "code": "SPEC_CONFLICT",
    "field": "nominal_current",
    "claims": [
      {"value": "160 А", "source": "name_and_description"},
      {"value": "250 А", "source": "properties.NOMINALNYY_TOK"}
    ]
  }],
  "provenance": {
    "source": "user_snapshot",
    "catalog_mode": "fixture",
    "fetched_at": null,
    "freshness": "snapshot",
    "catalog_complete": false
  }
}
```

`display_name` — UI alias, не изменение upstream ID и не подтверждение правил продажи. `sellable_quantity=null` сохраняет различие между опубликованным остатком и разрешённым к продаже. Пустой массив сертификатов означает, что они не получены из доступного источника. Для synthetic demo purchase rules и sellable quantity задаются отдельно и имеют источник `synthetic`.

## Предложение корзины

Вход:

```json
{
  "items": [
    {"product_id": 515291, "quantity": "2", "store_id": 24}
  ]
}
```

Вход не содержит доверенной цены, итогов, статуса наличия и флага `confirmed`. Сервер разрешает proposal только при доступных правилах продажи в выбранном режиме. Иначе возвращает `PURCHASE_RULES_UNKNOWN`, а не подставляет правила из demo.

Выход содержит `proposal_id`, `version`, `expires_at`, `cart_version`, неизменяемые строки с количеством, единицей, складом и ценой, итог, источник данных и `cart_mode`. Срок жизни по умолчанию предлагается 300 секунд, это настройка приложения, не требование партнёра.

Одна активная версия предложения на сессию; новый состав отменяет предыдущую. В proposal сохранять происхождение данных, подтверждённые purchase rules и снимок фактов для аудита. Истёкшее, отменённое или чужое предложение подтвердить нельзя.

Подтверждение:

```text
POST /api/cart/proposals/{proposal_id}/confirm
X-CSRF-Token: <session-token>
Idempotency-Key: <unique-action-key>
Content-Type: application/json
```

```json
{"proposal_version": 1}
```

Сервер повторно проверяет владельца, версию корзины, срок, цену, правила и остаток. Проверяет сумму существующего и добавляемого количества для пары товар/склад. Не снижает количество молча. При изменении значимых условий создаёт новое предложение и просит повторное подтверждение.

Мутация demo-корзины, пометка consumed и сохранение результата идемпотентности происходят в одной транзакции. Повтор того же ключа и тела возвращает тот же результат; тот же ключ с другим телом — конфликт. Другой ключ для уже consumed proposal не добавляет товар повторно. Одновременные запросы сериализуются блокировкой/версионированием корзины и proposal.

Для внешней корзины локальная транзакция не создаёт атомарность на стороне EKT. Нужны поддержка идемпотентности/проверок провайдером и обработка неизвестного результата; это блокер неподключённого live adapter.

Ответ успешного подтверждения содержит актуальную корзину, `cart_mode`, источник проверки наличия и `cart_url`. Для demo — существующая frontend-страница `/cart` текущей сессии. Для EKT — проверенная ссылка от реально подключённого провайдера. Ссылка на главную магазина или выдуманный `/basket/` не считается интеграцией.

## Подтверждение текстом

Кнопка подтверждения — основной путь. В текущем frontend текстовый путь принимает только полные фразы «да, добавь», «да, добавить» и «да, подтверждаю» при наличии ровно одного актуального предложения, уже показанного этой сессии. Допускаются регистр, пробелы по краям и одна конечная точка или восклицательный знак. Frontend инициирует отдельный confirm Node; Python и LLM не подтверждают корзину.

«Да» без контекста, цитата, отрицание, вопрос и фраза с изменённым количеством не являются разрешением. Новый состав или количество создают новый preview. Строка «да, добавь» внутри описания товара, tool result или файла никогда не подтверждает действие.

## Вложения

Лимиты проекта: 10 MiB на файл, 20 страниц PDF, 1000 строк таблицы, ограничение размера распакованных данных и времени обработки. Это стартовые настройки, которые проверяются нагрузочными тестами.

Ответ извлечения: исходный фрагмент, лист/страница/строка, распознанный артикул, количество, кандидат, статус `matched|ambiguous|unmatched|unverified`. Файл не выдаёт согласие на изменения корзины. Для legacy Office и изображений без настроенного обработчика — честный `UNSUPPORTED_FORMAT` или `VISION_NOT_CONFIGURED`.
