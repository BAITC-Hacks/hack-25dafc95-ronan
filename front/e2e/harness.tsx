// Browser-test fixture only. Requests below are intercepted by Playwright;
// no backend, server route, or real API endpoint is implemented.
import { createRoot } from "react-dom/client";
import { Assistant } from "../src/Assistant";
import { useAssistant } from "../src/useAssistant";
import { catalog } from "../src/catalog";
import { emptyCart, quote } from "../src/cartEngine";
import type { DataSource } from "../src/types";
import "../src/site.css";
const source: DataSource = {
  mode: "api",
  cartUrl: "#/cart",
  getCatalog: async () => catalog,
  getCart: async () => emptyCart(),
  chat: async () => {
    const r = await fetch("/__test__/chat");
    if (!r.ok) throw new Error("Ошибка сети");
    return r.json();
  },
  propose: async (intent) =>
    quote(
      emptyCart(),
      catalog.find((p) => p.id === intent.productId)!,
      intent,
    ),
  commit: async (p) => {
    const r = await fetch("/__test__/commit", {
      method: "POST",
      body: JSON.stringify(p),
    });
    if (!r.ok) throw new Error("Ошибка изменения");
    return r.json();
  },
  reconcile: async (id) => {
    const r = await fetch("/__test__/reconcile?id=" + id);
    if (!r.ok) throw new Error("Ошибка сверки");
    return r.json();
  },
};
function Harness() {
  const c = useAssistant(source);
  return <Assistant {...c} />;
}
createRoot(document.getElementById("root")!).render(<Harness />);
