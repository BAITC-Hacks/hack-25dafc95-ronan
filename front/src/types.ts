export type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  icon: "cable" | "breaker" | "light" | "box";
  price: number | null;
  unit: string;
  step: number;
  min: number;
  stocks: { warehouse: string; quantity: number | null }[];
  specs: Record<string, string>;
  certificate: { name: string; url: string } | null;
  canPurchase?: boolean;
};
export type Line = {
  productId: string;
  warehouse: string;
  quantity: number;
  price: number;
};
export type Cart = { revision: number; lines: Line[] };
export type Intent = {
  kind: "add" | "set" | "remove";
  productId: string;
  warehouse: string;
  quantity: number;
};
export type Proposal = {
  id: string;
  intent: Intent;
  product: Product;
  before: number;
  after: number;
  price: number;
  available: number;
  revision: number;
  status: "active" | "pending" | "done" | "cancelled" | "superseded";
};
export type ChatResult = {
  text: string;
  products?: Product[];
  analog?: { reason: string; matches: string[]; differences: string[] };
};
export type AttachmentResult = { text: string };
export type MutationResult =
  | { kind: "applied"; cart: Cart }
  | { kind: "changed"; cart: Cart; proposal: Proposal; message: string };
export type Reconciliation = {
  status: "applied" | "not-applied" | "unknown";
  cart: Cart;
};
/** The real implementation belongs to the team. No endpoint is inferred here. */
export interface DataSource {
  mode: "demo" | "api";
  cartUrl: string;
  getCatalog(): Promise<Product[]>;
  getCart(): Promise<Cart>;
  chat(text: string): Promise<ChatResult>;
  upload?(file: File): Promise<AttachmentResult>;
  propose(intent: Intent): Promise<Proposal>;
  commit(proposal: Proposal): Promise<MutationResult>;
  cancel?(proposalId: string): Promise<void>;
  reconcile(operationId: string): Promise<Reconciliation>;
  reset?(): Promise<Cart>;
}
