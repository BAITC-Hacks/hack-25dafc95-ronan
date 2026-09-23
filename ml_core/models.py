"""Typed catalog entities and tolerant parsing of API product payloads."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping
from urllib.parse import unquote, urlparse


def _first_value(data: Mapping[str, Any], *keys: str) -> Any:
    """Return the first non-empty value found under one of *keys*."""
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None


def _as_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    return str(value)


def _as_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, Mapping):
        value = _first_value(value, "value", "amount", "price", "current")
    if isinstance(value, str):
        value = value.replace("\u00a0", "").replace(" ", "").replace(",", ".")
        cleaned = "".join(char for char in value if char.isdigit() or char in ".-")
        value = cleaned
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _category_name(value: Any) -> str | None:
    if isinstance(value, Mapping):
        value = _first_value(value, "name", "title", "label", "title_ru")
    return _as_text(value)


def _category_from_product_url(value: Any) -> str | None:
    """Return the product-family slug immediately before a product URL's own slug."""
    url = _as_text(value)
    if not url:
        return None
    path_segments = [unquote(segment) for segment in urlparse(url).path.split("/") if segment]
    # A normal catalog URL ends in ``.../<product-family>/<product-slug>/``.
    return path_segments[-2] if len(path_segments) >= 2 else None


def _specifications(value: Any) -> dict[str, str]:
    """Normalise common object and list-based specification formats."""
    if isinstance(value, Mapping):
        result: dict[str, str] = {}
        for key, item in value.items():
            if isinstance(item, Mapping):
                item = _first_value(item, "value", "name", "title")
            elif isinstance(item, list):
                item = ", ".join(filter(None, (_as_text(part) for part in item)))
            text = _as_text(item)
            if text is not None:
                result[str(key)] = text
        return result

    if isinstance(value, list):
        result = {}
        for item in value:
            if not isinstance(item, Mapping):
                continue
            key = _first_value(item, "name", "key", "title", "attribute")
            item_value = _first_value(item, "value", "display_value", "text")
            key_text, value_text = _as_text(key), _as_text(item_value)
            if key_text and value_text:
                result[key_text] = value_text
        return result
    return {}


def _stock(value: Any) -> dict[str, float]:
    """Convert a stock quantity or warehouse collection to a quantity mapping."""
    if value is None:
        return {}
    if isinstance(value, Mapping):
        # A single stock object (rather than an id -> quantity mapping).
        direct_quantity = _as_float(_first_value(value, "quantity", "qty", "stock", "amount"))
        warehouse = _as_text(_first_value(value, "warehouse", "warehouse_name", "name"))
        if direct_quantity is not None and warehouse is not None:
            return {warehouse: direct_quantity}

        result: dict[str, float] = {}
        for key, item in value.items():
            quantity = _as_float(item)
            if quantity is not None:
                result[str(key)] = quantity
            elif isinstance(item, Mapping):
                quantity = _as_float(_first_value(item, "quantity", "qty", "stock", "amount"))
                item_warehouse = _as_text(_first_value(item, "warehouse", "warehouse_name", "name"))
                if quantity is not None:
                    result[item_warehouse or str(key)] = quantity
        return result
    if isinstance(value, list):
        result = {}
        for index, item in enumerate(value):
            if not isinstance(item, Mapping):
                continue
            quantity = _as_float(_first_value(item, "quantity", "qty", "stock", "amount"))
            warehouse = _as_text(_first_value(item, "warehouse", "warehouse_name", "name", "id"))
            if quantity is not None:
                result[warehouse or str(index)] = quantity
        return result
    quantity = _as_float(value)
    return {"total": quantity} if quantity is not None else {}


def _certificate_url(data: Mapping[str, Any]) -> str | None:
    direct = _as_text(_first_value(data, "certificate_url", "certificate", "certificateUrl"))
    if direct:
        return direct
    documents = _first_value(data, "documents", "files", "certificates")
    if isinstance(documents, list):
        for document in documents:
            if not isinstance(document, Mapping):
                continue
            kind = _as_text(_first_value(document, "type", "kind", "name", "title")) or ""
            url = _as_text(_first_value(document, "url", "link", "file"))
            if url and ("cert" in kind.lower() or "сертиф" in kind.lower()):
                return url
    return None


@dataclass(frozen=True, slots=True)
class Product:
    """A stable, API-independent representation of a catalog product."""

    sku: str
    name: str
    category: str | None = None
    key_specs: Mapping[str, str] = field(default_factory=dict)
    certificate: str | None = None
    price: float | None = None
    stock_by_warehouse: Mapping[str, float] = field(default_factory=dict)
    availability_status: str = "unknown"

    @property
    def id(self) -> str:
        """Alias retained for API consumers that call the catalog key ``id``."""
        return self.sku

    @property
    def total_stock(self) -> float:
        return sum(max(0.0, quantity) for quantity in self.stock_by_warehouse.values())

    @property
    def in_stock(self) -> bool:
        unavailable = {"out_of_stock", "unavailable", "not_available", "нет в наличии"}
        return self.total_stock > 0 and self.availability_status.lower() not in unavailable

    @classmethod
    def from_api(cls, payload: Mapping[str, Any]) -> "Product":
        """Parse a list/detail endpoint payload without leaking its schema onward.

        The aliases cover typical English and Russian e-commerce field names.
        If the live API has a different envelope, only this adapter needs changing.
        """
        sku = _as_text(
            _first_value(payload, "id", "product_id", "sku", "article", "vendor_code", "артикул")
        )
        if not sku:
            raise ValueError("Product payload has no sku/article/id")
        name = _as_text(_first_value(payload, "name", "title", "product_name", "наименование"))
        if not name:
            raise ValueError(f"Product {sku!r} has no name")

        category = _category_name(
            _first_value(payload, "category", "category_name", "group", "section", "категория")
        )
        if category is None:
            category = _category_from_product_url(payload.get("url"))
        specs = _specifications(
            _first_value(payload, "key_specs", "specifications", "specs", "attributes", "properties", "характеристики")
        )
        stock = _stock(
            _first_value(payload, "stock_by_warehouse", "warehouses", "stocks", "stock", "quantity", "qty", "остатки")
        )
        status = _as_text(
            _first_value(payload, "availability_status", "availability", "status", "available")
        )
        if status is None:
            status = "in_stock" if sum(stock.values()) > 0 else "out_of_stock"
        elif isinstance(_first_value(payload, "available"), bool):
            status = "in_stock" if payload["available"] else "out_of_stock"

        return cls(
            sku=sku,
            name=name,
            category=category,
            key_specs=specs,
            certificate=_certificate_url(payload),
            price=_as_float(_first_value(payload, "price", "current_price", "price_current", "cost", "цена")),
            stock_by_warehouse=stock,
            availability_status=status,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "sku": self.sku,
            "name": self.name,
            "category": self.category,
            "key_specs": dict(self.key_specs),
            "certificate": self.certificate,
            "price": self.price,
            "stock_by_warehouse": dict(self.stock_by_warehouse),
            "availability_status": self.availability_status,
        }

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "Product":
        return cls(
            sku=str(payload["sku"]),
            name=str(payload["name"]),
            category=_as_text(payload.get("category")),
            key_specs=_specifications(payload.get("key_specs")),
            certificate=_as_text(payload.get("certificate")),
            price=_as_float(payload.get("price")),
            stock_by_warehouse=_stock(payload.get("stock_by_warehouse")),
            availability_status=str(payload.get("availability_status", "unknown")),
        )


@dataclass(frozen=True, slots=True)
class ProductAlternative:
    """An in-stock substitute, accompanied by an explainable ranking result."""

    product: Product
    score: float
    reason: str
