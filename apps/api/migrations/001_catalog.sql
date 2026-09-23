CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog_products (
  upstream_id bigint PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('user_snapshot', 'ekt_live')),
  raw_json jsonb NOT NULL,
  article text,
  supplier_article text,
  barcode text,
  name text,
  price_amount numeric(20, 6),
  reported_quantity numeric(20, 6),
  detail_available boolean NOT NULL DEFAULT false,
  fetched_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_products_article_idx ON catalog_products (article);
CREATE INDEX IF NOT EXISTS catalog_products_supplier_article_idx ON catalog_products (supplier_article);
CREATE INDEX IF NOT EXISTS catalog_products_name_idx ON catalog_products (lower(name));

CREATE TABLE IF NOT EXISTS catalog_sync_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  pages_inspected integer NOT NULL DEFAULT 0,
  details_inspected integer NOT NULL DEFAULT 0,
  items_seen integer NOT NULL DEFAULT 0,
  complete boolean NOT NULL DEFAULT false,
  stop_reason text
);
