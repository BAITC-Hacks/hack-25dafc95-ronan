# Node ↔ Python ml_core, draft для согласования

Node вызывает `POST {ML_CORE_URL}/v1/parse-rank` с JSON:

```json
{
  "message": "Есть 027228 в Астане?",
  "candidates": [
    { "id": 515291, "name": "027228 АВ DRX250 MT 3ф 160А 18ka Legrand (1)", "article": "200300285_" }
  ]
}
```

Ответ Python:

```json
{ "query": "027228", "ranked_ids": [515291] }
```

`query` — подсказка длиной до 100 символов; `ranked_ids` — перестановка или подмножество переданных candidate ID. Node проверяет форму и принадлежность каждого ID, берёт карточки, цены и остатки только из своего каталога. Python не получает session cookie, CSRF token, cart proposal и инструмент записи; ответ Python никогда не подтверждает корзину. При таймауте, ошибке HTTP или неверном JSON Node возвращает контролируемый fallback. Предлагаемый timeout — 800 мс. Этот контракт требует подтверждения ML-участником до внешней интеграции.
