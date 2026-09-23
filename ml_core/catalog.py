"""Authenticated catalog download, local caching, and retrieval functions."""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import tempfile
import threading
from collections.abc import Iterable, Mapping
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from dotenv import load_dotenv

from .models import Product, ProductAlternative

# Load a local .env for development without replacing values explicitly set by the host.
load_dotenv()

DEFAULT_BASE_URL = "https://ekt.kz/api"
DEFAULT_CACHE_PATH = Path(".cache") / "ekt_catalog.json"
_TOKEN_RE = re.compile(r"[\w-]+", re.UNICODE)
_NUMBER_RE = re.compile(r"[-+]?\d+(?:[,.]\d+)?")
_DETAIL_WORKERS = 8
logger = logging.getLogger(__name__)


class CatalogApiError(RuntimeError):
    """Raised when the remote catalog cannot be fetched or decoded."""


class CatalogClient:
    """Small HTTP Basic Auth client for EKT's product API."""

    def __init__(
        self,
        username: str,
        password: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 20.0,
    ) -> None:
        if not username or not password:
            raise ValueError("EKT API username and password are required")
        self.username = username
        self.password = password
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    @classmethod
    def from_env(cls, **kwargs: Any) -> "CatalogClient":
        """Build a client using EKT_API_USER and EKT_API_PASS, never literals."""
        username = os.getenv("EKT_API_USER")
        password = os.getenv("EKT_API_PASS")
        if not username or not password:
            raise RuntimeError(
                "Set EKT_API_USER and EKT_API_PASS before initializing the EKT catalog."
            )
        return cls(username, password, **kwargs)

    def _get_json(self, path: str, params: Mapping[str, Any] | None = None) -> Any:
        query = f"?{urlencode(params)}" if params else ""
        token = base64.b64encode(f"{self.username}:{self.password}".encode("utf-8")).decode("ascii")
        request = Request(
            f"{self.base_url}{path}{query}",
            headers={
                "Authorization": f"Basic {token}",
                "Accept": "application/json",
                "User-Agent": "ekt-catalog-client/1.0",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:  # nosec B310 - API URL is configured by backend
                charset = response.headers.get_content_charset() or "utf-8"
                return json.loads(response.read().decode(charset))
        except HTTPError as exc:
            raise CatalogApiError(f"EKT API returned HTTP {exc.code} for {path}") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise CatalogApiError(f"Unable to fetch/decode EKT API {path}: {exc}") from exc

    def fetch_all_products(self, *, limit: int | None = None) -> list[dict[str, Any]]:
        """Fetch listing pages, then concurrently enrich up to ``limit`` detail records.

        ``limit=None`` fetches the whole catalog. Detail failures are isolated so a
        malformed or temporarily unavailable product does not abort a full refresh.
        """
        if limit is not None and limit < 0:
            raise ValueError("limit must be zero or a positive integer")
        listing_rows = self._fetch_listing_rows(limit=limit)
        total = len(listing_rows)
        if total == 0:
            return []

        def fetch_detail(index: int, row: dict[str, Any]) -> tuple[int, dict[str, Any]]:
            product_id = _product_identifier(row)
            if product_id is None:
                raise CatalogApiError("Listing product has no id, SKU, or article")
            detail = self._get_json("/products/detail", {"id": product_id})
            detail_row = _unwrap_product(detail)
            merged = dict(row)
            merged.update(detail_row)
            return index, merged

        records_by_index: dict[int, dict[str, Any]] = {}
        completed = 0
        with ThreadPoolExecutor(max_workers=_DETAIL_WORKERS, thread_name_prefix="ekt-detail") as executor:
            futures = {
                executor.submit(fetch_detail, index, row): (index, _product_identifier(row))
                for index, row in enumerate(listing_rows)
            }
            for future in as_completed(futures):
                _, product_id = futures[future]
                try:
                    index, record = future.result()
                except Exception as exc:
                    logger.warning("Skipping failed SKU %s while fetching detail: %s", product_id, exc)
                else:
                    records_by_index[index] = record
                completed += 1
                if completed % 10 == 0 or completed == total:
                    print(f"Fetched {completed}/{total} products...", flush=True)

        # Futures finish out of order; preserving listing order makes refreshes deterministic.
        return [records_by_index[index] for index in sorted(records_by_index)]

    def _fetch_listing_rows(self, *, limit: int | None = None) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        seen_product_ids: set[str] = set()
        seen_page_signatures: set[tuple[str, ...]] = set()
        page = 1
        # The high guard prevents an unexpected server bug from making a startup loop forever.
        while page <= 10_000:
            envelope = self._get_json("/products", {"page": page})
            page_rows = _extract_rows(envelope)
            if not page_rows:
                break
            signature = tuple(str(_product_identifier(item) or index) for index, item in enumerate(page_rows))
            if signature in seen_page_signatures:
                break
            seen_page_signatures.add(signature)
            rows.extend(page_rows)
            seen_product_ids.update(
                str(identifier)
                for row in page_rows
                if (identifier := _product_identifier(row)) is not None
            )
            # Stop before the next listing request: a limit bounds pagination,
            # not merely the later detail-enrichment phase.
            if limit is not None and len(seen_product_ids) >= limit:
                break
            if not _has_next_page(envelope, page, len(page_rows)):
                break
            page += 1
        else:
            raise CatalogApiError("Stopped after 10,000 catalog pages; pagination did not terminate")

        deduplicated: dict[str, dict[str, Any]] = {}
        for row in rows:
            identifier = _product_identifier(row)
            if identifier is not None:
                deduplicated[str(identifier)] = row
        products = list(deduplicated.values())
        return products if limit is None else products[:limit]


def _extract_rows(envelope: Any) -> list[dict[str, Any]]:
    if isinstance(envelope, list):
        return [item for item in envelope if isinstance(item, dict)]
    if not isinstance(envelope, dict):
        raise CatalogApiError("Product list response must be an object or list")
    for key in ("products", "items", "data", "result"):
        candidate = envelope.get(key)
        if isinstance(candidate, list):
            return [item for item in candidate if isinstance(item, dict)]
        if isinstance(candidate, dict):
            for nested_key in ("products", "items", "data", "results"):
                nested = candidate.get(nested_key)
                if isinstance(nested, list):
                    return [item for item in nested if isinstance(item, dict)]
    return []


def _unwrap_product(envelope: Any) -> dict[str, Any]:
    if not isinstance(envelope, dict):
        raise CatalogApiError("Product detail response must be an object")
    for key in ("product", "data", "result", "item"):
        candidate = envelope.get(key)
        if isinstance(candidate, dict):
            return candidate
    return envelope


def _product_identifier(row: Mapping[str, Any]) -> str | int | None:
    for key in ("id", "product_id", "sku", "article", "vendor_code", "артикул"):
        value = row.get(key)
        if value not in (None, ""):
            return value
    return None


def _has_next_page(envelope: Any, page: int, page_row_count: int) -> bool:
    """Use pagination metadata if available; otherwise continue until an empty page."""
    if not isinstance(envelope, Mapping):
        return page_row_count > 0
    for container in (envelope, envelope.get("pagination"), envelope.get("meta")):
        if not isinstance(container, Mapping):
            continue
        last_page = container.get("last_page", container.get("total_pages"))
        if isinstance(last_page, (int, float)):
            return page < int(last_page)
        next_page = container.get("next_page", container.get("nextPage", container.get("next")))
        if next_page is not None:
            return bool(next_page)
    return page_row_count > 0


def _normalise(text: str) -> str:
    return " ".join(_TOKEN_RE.findall(text.casefold()))


def _tokens(text: str) -> set[str]:
    tokens: set[str] = set()
    for token in _TOKEN_RE.findall(text.casefold()):
        tokens.add(token)
        # Treat "16A" and "16 A" equivalently, which matters for electrical ratings.
        tokens.update(part for part in re.findall(r"\d+(?:[.,]\d+)?|[^\d_]+", token) if part)
    return tokens


def _search_score(query: str, product: Product) -> float:
    query_tokens = _tokens(query)
    if not query_tokens:
        return 0.0
    name_tokens = _tokens(product.name)
    category_tokens = _tokens(product.category or "")
    spec_tokens = _tokens(" ".join(f"{key} {value}" for key, value in product.key_specs.items()))
    weighted_hits = (
        3 * len(query_tokens & name_tokens)
        + 2 * len(query_tokens & category_tokens)
        + len(query_tokens & spec_tokens)
    )
    # A phrase ratio still finds partial terms and transposed words.
    haystack = " ".join((product.name, product.category or "", " ".join(product.key_specs.values())))
    phrase_ratio = SequenceMatcher(None, _normalise(query), _normalise(haystack)).ratio()
    return weighted_hits / (3 * len(query_tokens)) + 0.25 * phrase_ratio


def _spec_value_similarity(left: str, right: str) -> float:
    left_normalised, right_normalised = _normalise(left), _normalise(right)
    if left_normalised == right_normalised:
        return 1.0
    left_numbers = [float(value.replace(",", ".")) for value in _NUMBER_RE.findall(left)]
    right_numbers = [float(value.replace(",", ".")) for value in _NUMBER_RE.findall(right)]
    if left_numbers and right_numbers:
        baseline = max(abs(left_numbers[0]), abs(right_numbers[0]), 1.0)
        numeric_similarity = max(0.0, 1.0 - abs(left_numbers[0] - right_numbers[0]) / baseline)
        return max(numeric_similarity, SequenceMatcher(None, left_normalised, right_normalised).ratio() * 0.5)
    return SequenceMatcher(None, left_normalised, right_normalised).ratio()


def _spec_similarity(target: Product, candidate: Product) -> tuple[float, list[str]]:
    target_specs = {_normalise(key): (key, value) for key, value in target.key_specs.items()}
    candidate_specs = {_normalise(key): (key, value) for key, value in candidate.key_specs.items()}
    shared = target_specs.keys() & candidate_specs.keys()
    if not shared:
        return 0.0, []
    scores: list[float] = []
    matching_labels: list[str] = []
    for key, (target_key, target_value) in target_specs.items():
        if key not in shared:
            continue
        _, candidate_value = candidate_specs[key]
        similarity = _spec_value_similarity(target_value, candidate_value)
        # Voltage is commonly the most safety/compatibility-relevant electrical spec.
        weight = 1.5 if "voltage" in key or "напряж" in key else 1.0
        scores.extend([similarity] * int(weight * 2))
        if _normalise(target_value) == _normalise(candidate_value):
            matching_labels.append(target_key)
    return sum(scores) / len(scores), matching_labels


def _price_similarity(target: Product, candidate: Product) -> tuple[float, float | None]:
    if target.price is None or candidate.price is None or target.price <= 0:
        return 0.5, None
    delta = (candidate.price - target.price) / target.price
    return max(0.0, 1.0 - min(abs(delta), 1.0)), delta


def _display_spec_label(label: str) -> str:
    lowered = label.casefold()
    if "voltage" in lowered or "напряж" in lowered or "napryazhenie" in lowered:
        return "voltage rating"
    if "current" in lowered or "ток" in lowered or "nominalnyy_tok" in lowered:
        return "current rating"
    if "otklyuchayushchaya_sposobnost" in lowered:
        return "breaking capacity"
    if "kolichestvo_polyusov" in lowered:
        return "number of poles"
    if "torgovaya_marka" in lowered:
        return "brand"
    if "power" in lowered or "мощност" in lowered:
        return "power rating"
    return label


def _alternative_reason(matching_labels: list[str], price_delta: float | None) -> str:
    pieces = []
    if matching_labels:
        pieces.append(f"same {_display_spec_label(matching_labels[0])}")
    if price_delta is not None:
        percentage = round(abs(price_delta) * 100)
        if percentage == 0:
            pieces.append("same price")
        else:
            direction = "higher" if price_delta > 0 else "lower"
            pieces.append(f"{percentage}% {direction} price")
    pieces.append("in stock")
    return ", ".join(pieces)


class CatalogService:
    """Thread-safe in-memory index backed by a versioned local JSON cache."""

    def __init__(self, client: CatalogClient, cache_path: str | Path = DEFAULT_CACHE_PATH) -> None:
        self.client = client
        self.cache_path = Path(cache_path)
        self._products: tuple[Product, ...] = ()
        self._by_sku: dict[str, Product] = {}
        self._loaded = False
        self._lock = threading.RLock()

    @classmethod
    def from_products(cls, products: Iterable[Product]) -> "CatalogService":
        """Build an in-memory service for tests or offline development."""
        service = cls.__new__(cls)
        service.client = None  # type: ignore[assignment]
        service.cache_path = Path(".cache") / "test-catalog.json"
        service._products = ()
        service._by_sku = {}
        service._loaded = False
        service._lock = threading.RLock()
        service.replace_products(products)
        return service

    def replace_products(self, products: Iterable[Product]) -> None:
        """Replace the in-memory index; useful for controlled offline setup/tests."""
        with self._lock:
            by_sku = {product.sku: product for product in products}
            self._by_sku = by_sku
            self._products = tuple(by_sku.values())
            self._loaded = True

    def startup(self, *, force_refresh: bool = False, limit: int | None = None) -> None:
        """Load the on-disk catalog, downloading it only if absent or requested.

        Passing a limit is an explicit testing refresh and bypasses the existing
        cache so callers reliably receive a limited catalog.
        """
        if limit is not None:
            force_refresh = True
        with self._lock:
            if self._loaded and not force_refresh:
                return
            if not force_refresh and self._load_cache():
                return
        self.refresh(limit=limit)

    def refresh(self, *, limit: int | None = None) -> None:
        """Fetch product details and replace the cache unless this is a limited test fetch."""
        if self.client is None:
            raise RuntimeError("This offline CatalogService has no API client to refresh")
        raw_products = self.client.fetch_all_products(limit=limit)
        parsed: list[Product] = []
        rejected: list[str] = []
        for raw in raw_products:
            try:
                parsed.append(Product.from_api(raw))
            except ValueError as exc:
                rejected.append(str(exc))
        if raw_products and not parsed:
            raise CatalogApiError(f"No catalog products could be parsed: {rejected[:3]}")
        # Do not mark a partial local-test fetch as the complete persistent catalog.
        if limit is None:
            self._write_cache(parsed)
        self.replace_products(parsed)

    def _load_cache(self) -> bool:
        if not self.cache_path.is_file():
            return False
        try:
            with self.cache_path.open("r", encoding="utf-8") as file:
                payload = json.load(file)
            rows = payload["products"] if isinstance(payload, dict) else payload
            if not isinstance(rows, list):
                raise ValueError("products is not a list")
            self.replace_products(Product.from_dict(row) for row in rows if isinstance(row, dict))
            return True
        except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
            raise CatalogApiError(f"Catalog cache {self.cache_path} is invalid: {exc}") from exc

    def _write_cache(self, products: Iterable[Product]) -> None:
        serialised = {
            "version": 1,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "products": [product.to_dict() for product in products],
        }
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                "w", encoding="utf-8", delete=False, dir=self.cache_path.parent, suffix=".tmp"
            ) as temporary_file:
                temporary_path = temporary_file.name
                json.dump(serialised, temporary_file, ensure_ascii=False, indent=2)
                temporary_file.write("\n")
            Path(temporary_path).replace(self.cache_path)
        finally:
            if temporary_path and Path(temporary_path).exists():
                Path(temporary_path).unlink()

    def get_product(self, sku: str | int) -> Product | None:
        self.startup()
        return self._by_sku.get(str(sku))

    def search_products(self, query: str, *, limit: int = 10) -> list[Product]:
        """Rank free-text matches over name, category, and specification text."""
        self.startup()
        if not query or not query.strip() or limit <= 0:
            return []
        ranked = [(product, _search_score(query, product)) for product in self._products]
        ranked = [(product, score) for product, score in ranked if score >= 0.22]
        ranked.sort(key=lambda item: (-item[1], not item[0].in_stock, item[0].name.casefold(), item[0].sku))
        return [product for product, _ in ranked[:limit]]

    def find_alternatives(self, sku: str | int, *, limit: int = 3) -> list[ProductAlternative]:
        """Return explainable same-category in-stock alternatives for a zero-stock SKU."""
        self.startup()
        target = self._by_sku.get(str(sku))
        if target is None or target.in_stock or not target.category or limit <= 0:
            return []
        candidates: list[ProductAlternative] = []
        category = _normalise(target.category)
        for candidate in self._products:
            if candidate.sku == target.sku or not candidate.in_stock:
                continue
            if _normalise(candidate.category or "") != category:
                continue
            spec_score, matching_labels = _spec_similarity(target, candidate)
            price_score, price_delta = _price_similarity(target, candidate)
            # The score is deliberately dominated by shared technical specs, then price proximity.
            score = 0.75 * spec_score + 0.25 * price_score
            candidates.append(
                ProductAlternative(
                    product=candidate,
                    score=round(score, 4),
                    reason=_alternative_reason(matching_labels, price_delta),
                )
            )
        candidates.sort(key=lambda item: (-item.score, item.product.price is None, item.product.price or 0, item.product.sku))
        return candidates[:limit]


_default_service: CatalogService | None = None
_default_lock = threading.RLock()


def configure_catalog(
    *, cache_path: str | Path = DEFAULT_CACHE_PATH, base_url: str = DEFAULT_BASE_URL, timeout: float = 20.0
) -> CatalogService:
    """Configure the process-wide service used by the module-level lookup helpers."""
    global _default_service
    with _default_lock:
        _default_service = CatalogService(CatalogClient.from_env(base_url=base_url, timeout=timeout), cache_path)
        return _default_service


def get_catalog_service() -> CatalogService:
    """Return the configured service, creating it from environment variables if needed."""
    global _default_service
    with _default_lock:
        if _default_service is None:
            _default_service = CatalogService(CatalogClient.from_env())
        return _default_service


def initialize_catalog(*, force_refresh: bool = False, limit: int | None = None) -> None:
    """Startup hook: load cache, or fetch it once if no cache exists.

    A non-``None`` limit performs a fresh, in-memory test fetch of the first N
    deduplicated listing rows and leaves any full cache intact.
    """
    get_catalog_service().startup(force_refresh=force_refresh, limit=limit)


def refresh_catalog(*, limit: int | None = None) -> None:
    """Re-download the catalog; a limit performs a non-persistent test refresh."""
    get_catalog_service().refresh(limit=limit)


def get_product(sku: str | int) -> Product | None:
    return get_catalog_service().get_product(sku)


def search_products(query: str, *, limit: int = 10) -> list[Product]:
    return get_catalog_service().search_products(query, limit=limit)


def find_alternatives(sku: str | int, *, limit: int = 3) -> list[ProductAlternative]:
    return get_catalog_service().find_alternatives(sku, limit=limit)
