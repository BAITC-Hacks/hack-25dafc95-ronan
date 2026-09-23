# Источники и происхождение решений

Дата подготовки: 23 сентября 2026 года.

## Материалы пользователя

- Два скриншота полного ТЗ HackAlem AI, разделы 1–10: основание REQUIREMENTS.md.
- Скриншот тестового API: Basic Auth и три варианта URL каталога. Секреты не копировались в этот пакет.
- JSON карточки 515291 из сообщения: `samples/ekt-product-515291.json`.
- Вложение `Pasted markdown(2).md`, страница 2 каталога: `samples/ekt-products-page2.json`.
- Первая страница каталога и скриншоты внешнего вида использованы для анализа. Их полные копии в пакет не включены.

Поля sample JSON сохранены без исправления товарных данных. Дата выгрузки, актуальность и доступность сервера по этим снимкам не устанавливались. Внешние запросы к EKT и операции с корзиной при подготовке пакета не выполнялись.

## Проверенная публичная документация

W1. OpenAI, выбор моделей Codex; описания Astra / Sol / Luna, настройки усилия и ограничения доступности:
`https://developers.openai.com/codex/models/`
Перенаправление на официальный ресурс:
`https://learn.chatgpt.com/docs/models`

W2. OpenAI, выпуск GPT-6 Astra:
`https://openai.com/index/gpt-6-astra/`

W3. OpenAI, семейство GPT-5.6; Terra — сбалансированный вариант, Luna — экономичный:
`https://openai.com/index/gpt-5-6/`

W4. OpenAI, правила AGENTS.md:
`https://developers.openai.com/codex/guides/agents-md/`

W5. OpenAI, function calling, в том числе strict JSON Schema:
`https://developers.openai.com/api/docs/guides/function-calling`

W6. Node.js, таблица релизов; Node.js 24 находится в LTS:
`https://nodejs.org/en/about/previous-releases`

W7. Fastify, валидация и сериализация:
`https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/`

W8. PostgreSQL, pg_trgm:
`https://www.postgresql.org/docs/current/pgtrgm.html`

## Что является предложением, а не фактом из ТЗ

Стек, роли участников, этапы, схема сессий, API вашего backend, срок жизни предложений, структура БД, лимиты файлов и стратегия поиска — проектные предложения. Партнёр не утверждал их в предоставленных материалах. Целевые метрики производительности — цели для проверки, а не результаты измерений.
