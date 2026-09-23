CREATE TABLE IF NOT EXISTS demo_sessions (
  id uuid PRIMARY KEY,
  csrf_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS demo_carts (
  session_id uuid PRIMARY KEY REFERENCES demo_sessions(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS demo_cart_items (
  session_id uuid NOT NULL REFERENCES demo_carts(session_id) ON DELETE CASCADE,
  product_id bigint NOT NULL,
  store_id integer NOT NULL,
  quantity numeric(20, 6) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  price_amount numeric(20, 6) NOT NULL CHECK (price_amount >= 0),
  currency text NOT NULL,
  fact_source text NOT NULL,
  PRIMARY KEY (session_id, product_id, store_id)
);

CREATE TABLE IF NOT EXISTS demo_cart_proposals (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  cart_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'consumed', 'cancelled')),
  expires_at timestamptz NOT NULL,
  lines jsonb NOT NULL,
  total_amount numeric(20, 6) NOT NULL,
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS demo_one_active_proposal ON demo_cart_proposals (session_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS demo_cart_idempotency (
  session_id uuid NOT NULL REFERENCES demo_sessions(id) ON DELETE CASCADE,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, key)
);
