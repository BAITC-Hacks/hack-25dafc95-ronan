# hack-25dafc95-ronan

Hackathon team repository for Ronan.

## `ml_core` catalog module

`ml_core` is the dependency-light catalog/retrieval layer for the EKT chat
assistant. It uses Python's standard library, reads HTTP Basic Auth credentials
from `EKT_API_USER` and `EKT_API_PASS`, and never stores credentials in the
repository. Copy `.env.example` to your local `.env` (which is ignored), then
fill in the credentials. `python-dotenv` loads that file automatically when
`ml_core.catalog` is imported; explicitly exported environment variables still
take precedence.

```python
from ml_core import (
    PendingAction,
    find_alternatives,
    get_product,
    initialize_catalog,
    refresh_catalog,
    search_products,
)

# Call once from FastAPI's lifespan/startup hook. It loads .cache/ekt_catalog.json
# and fetches all /products pages plus /products/detail?id=... only when no cache exists.
initialize_catalog()

product = get_product("ARTICLE-123")
matches = search_products("16A 230V circuit breaker")
alternatives = find_alternatives("ARTICLE-123")  # up to 3 when that SKU is out of stock

# Invoke manually from an admin job/endpoint to re-fetch and atomically replace the cache.
refresh_catalog()

# Development-only: fetch the first 25 products concurrently without replacing
# the full on-disk cache.
initialize_catalog(limit=25)
```

`Product` contains the normalized SKU, name, category, key specifications,
certificate URL, price, warehouse stock, and availability. `find_alternatives`
returns `ProductAlternative(product, score, reason)` values ranked by shared
specification similarity (75%) and price similarity (25%). Runtime lookups use
the in-memory cache rather than the live catalog API.

For state-changing actions, use the server-side confirm gate; do not let the
model execute a proposal directly:

```python
gate = PendingAction()
gate.propose(session_id, {"action": "add_to_cart", "sku": "ARTICLE-123", "qty": 2})

# When the *next raw user message* arrives:
gate.record_user_message(session_id, user_text)
action_to_execute = gate.confirm(session_id)  # action only for explicit yes/да; always consumes state
```

Run the isolated tests with `python -m pytest`.
