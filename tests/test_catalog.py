import logging

from ml_core.catalog import CatalogApiError, CatalogClient, CatalogService
from ml_core.models import Product


def product(
    sku: str,
    name: str,
    *,
    category: str = "Circuit breakers",
    voltage: str = "230 V",
    current: str = "16 A",
    price: float = 1000,
    stock: float = 5,
) -> Product:
    return Product(
        sku=sku,
        name=name,
        category=category,
        key_specs={"Voltage": voltage, "Current": current},
        price=price,
        stock_by_warehouse={"Almaty": stock},
        availability_status="in_stock" if stock else "out_of_stock",
    )


def test_search_matches_name_category_and_specs() -> None:
    service = CatalogService.from_products(
        [
            product("A-16", "Schneider circuit breaker 16A"),
            product("B-25", "Cable", category="Cables", current="25 A"),
        ]
    )

    assert [item.sku for item in service.search_products("breaker 16A")] == ["A-16"]
    assert [item.sku for item in service.search_products("cables 25")] == ["B-25"]


def test_alternatives_rank_shared_specs_above_closer_price() -> None:
    sold_out = product("OUT", "Breaker unavailable", price=1000, stock=0)
    same_specs = product("BEST", "Breaker compatible", price=1120, stock=2)
    wrong_voltage = product("OTHER", "Breaker nearby price", voltage="400 V", price=1010, stock=9)
    service = CatalogService.from_products([sold_out, wrong_voltage, same_specs])

    alternatives = service.find_alternatives("OUT")

    assert [item.product.sku for item in alternatives] == ["BEST", "OTHER"]
    assert alternatives[0].reason == "same voltage rating, 12% higher price, in stock"
    assert service.find_alternatives("BEST") == []


def test_url_derived_category_groups_real_api_products_and_prefers_id() -> None:
    family_url = (
        "https://ekt.kz/catalog/nizkovoltnaya_apparatura/"
        "silovye_avtomaticheskie_vyklyuchateli/drx125_mt_10_250_a_legrand/"
    )
    sold_out = Product.from_api(
        {
            "id": 27004,
            "article": "027004",
            "name": "DRX125 MT 3F 40A",
            "url": f"{family_url}027004_av_drx125_mt_3f_40a_10ka_legrand_1/",
            "properties": {"NOMINALNOE_NAPRYAZHENIE": "230 V", "NOMINALNYY_TOK": "40 A"},
            "price": 1000,
            "quantity": 0,
        }
    )
    in_stock = Product.from_api(
        {
            "id": 27005,
            "article": "027005",
            "name": "DRX125 MT 3F 40A alternative",
            "url": f"{family_url}027005_av_drx125_mt_3f_40a_16ka_legrand_1/",
            "properties": {"NOMINALNOE_NAPRYAZHENIE": "230 V", "NOMINALNYY_TOK": "40 A"},
            "price": 1100,
            "quantity": 4,
        }
    )
    service = CatalogService.from_products([sold_out, in_stock])

    assert sold_out.sku == "27004"
    assert sold_out.category == "drx125_mt_10_250_a_legrand"
    alternatives = service.find_alternatives("27004")
    assert [item.product.sku for item in alternatives] == ["27005"]
    assert alternatives[0].reason == "same voltage rating, 10% higher price, in stock"


def test_detail_fetch_limit_reports_progress_and_skips_individual_errors(capsys, caplog) -> None:
    class FakeClient(CatalogClient):
        def __init__(self) -> None:
            pass

        def _fetch_listing_rows(self, *, limit: int | None = None) -> list[dict[str, object]]:
            rows = [{"id": index, "name": f"Product {index}"} for index in range(12)]
            return rows if limit is None else rows[:limit]

        def _get_json(self, path: str, params: dict[str, object] | None = None) -> dict[str, object]:
            assert path == "/products/detail"
            assert params is not None
            product_id = params["id"]
            if product_id == 5:
                raise CatalogApiError("temporary API failure")
            return {"id": product_id, "name": f"Detail {product_id}"}

    caplog.set_level(logging.WARNING, logger="ml_core.catalog")
    records = FakeClient().fetch_all_products(limit=12)

    assert [record["id"] for record in records] == [index for index in range(12) if index != 5]
    assert "Fetched 10/12 products..." in capsys.readouterr().out
    assert "Skipping failed SKU 5" in caplog.text


def test_limit_stops_pagination_before_unneeded_listing_requests() -> None:
    class CountingClient(CatalogClient):
        def __init__(self) -> None:
            self.calls: list[tuple[str, int]] = []

        def _get_json(self, path: str, params: dict[str, object] | None = None) -> dict[str, object]:
            assert params is not None
            page_or_id = int(params["page"] if path == "/products" else params["id"])
            self.calls.append((path, page_or_id))
            if path == "/products":
                first_id = (page_or_id - 1) * 5
                return {
                    "products": [{"id": product_id} for product_id in range(first_id, first_id + 5)],
                    "pagination": {"last_page": 5},
                }
            return {"id": page_or_id, "name": f"Detail {page_or_id}"}

    client = CountingClient()
    records = client.fetch_all_products(limit=7)

    listing_pages = [value for path, value in client.calls if path == "/products"]
    detail_ids = [value for path, value in client.calls if path == "/products/detail"]
    assert listing_pages == [1, 2]
    assert set(detail_ids) == set(range(7))
    assert len(detail_ids) == 7
    assert [record["id"] for record in records] == list(range(7))
