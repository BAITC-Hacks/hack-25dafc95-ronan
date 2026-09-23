"""Catalog retrieval primitives for the ekt.kz chat assistant.

Call :func:`initialize_catalog` from the backend's startup/lifespan handler.
The lookup helpers then operate entirely on the local JSON cache.
"""

from .catalog import (
    DEFAULT_CACHE_PATH,
    CatalogClient,
    CatalogService,
    configure_catalog,
    find_alternatives,
    get_catalog_service,
    get_product,
    initialize_catalog,
    refresh_catalog,
    search_products,
)
from .models import Product, ProductAlternative
from .pending_actions import PendingAction

__all__ = [
    "DEFAULT_CACHE_PATH",
    "CatalogClient",
    "CatalogService",
    "Product",
    "ProductAlternative",
    "PendingAction",
    "configure_catalog",
    "find_alternatives",
    "get_catalog_service",
    "get_product",
    "initialize_catalog",
    "refresh_catalog",
    "search_products",
]
