import { FileText, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { keyOf } from "./cartEngine";
import "./products.css";
import type { Cart, Intent, Product } from "./types";

const money = (n: number) => new Intl.NumberFormat("ru-KZ").format(n) + " ₸";
export function ProductArt({
  kind,
  small = false,
}: {
  kind: Product["icon"];
  small?: boolean;
}) {
  return (
    <div
      className={`product-art ${kind} ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      {kind === "cable" ? (
        <div className="cable-coil">
          <i />
          <i />
          <i />
          <b />
        </div>
      ) : kind === "breaker" ? (
        <div className="breaker-body">
          <span>DEMO</span>
          <i />
          <b>C16</b>
          <em />
        </div>
      ) : kind === "light" ? (
        <div className="lamp-body">
          <i />
        </div>
      ) : (
        <div className="box-body">
          <i />
          <i />
          <i />
        </div>
      )}
    </div>
  );
}
export function ProductCard({
  product: p,
  onPropose,
  disabled,
}: {
  product: Product;
  onPropose: (i: Intent) => void;
  disabled: boolean;
}) {
  const [warehouse, setWarehouse] = useState(p.stocks[0].warehouse);
  const [qty, setQty] = useState(String(p.min));
  const stock = p.stocks.find((s) => s.warehouse === warehouse)?.quantity;
  return (
    <article className="product-card">
      <div className="product-heading">
        <ProductArt kind={p.icon} small />
        <div>
          <span className="sku">{p.sku}</span>
          <h3>{p.name}</h3>
          <strong>
            {p.price === null ? "Цена неизвестна" : money(p.price)}{" "}
            <small>/ {p.unit}</small>
          </strong>
        </div>
      </div>
      <div className="spec-grid">
        {Object.entries(p.specs).map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
      <label className="field-label">
        Склад
        <select
          value={warehouse}
          onChange={(e) => setWarehouse(e.target.value)}
        >
          {p.stocks.map((s) => (
            <option key={s.warehouse}>{s.warehouse}</option>
          ))}
        </select>
      </label>
      <p className={`stock ${stock === 0 ? "unavailable" : ""}`}>
        <span className="dot" />
        {stock == null
          ? "Остаток неизвестен"
          : stock === 0
            ? "Нет в наличии"
            : `В наличии: ${stock} ${p.unit}`}
      </p>
      <div className="certificate">
        {p.certificate ? (
          <a href={p.certificate.url} target="_blank" rel="noreferrer">
            <FileText size={14} />
            {p.certificate.name} ↗
          </a>
        ) : (
          <span>
            <FileText size={14} /> Сертификат не предоставлен
          </span>
        )}
      </div>
      <div className="product-actions">
        <label>
          Количество, {p.unit}
          <input
            aria-label={`Количество ${p.sku}`}
            type="number"
            min={p.min}
            step={p.step}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={
            disabled || stock == null || stock === 0 || p.price === null
          }
          onClick={() =>
            onPropose({
              kind: "add",
              productId: p.id,
              warehouse,
              quantity: Number(qty),
            })
          }
        >
          <Plus size={16} /> В корзину
        </button>
      </div>
      <p className="micro">
        Мин. {p.min} {p.unit} · шаг {p.step} {p.unit}. Далее — подтверждение.
      </p>
    </article>
  );
}
export function CartLine({
  p,
  line,
  onPropose,
  disabled,
}: {
  p: Product;
  line: Cart["lines"][number];
  onPropose: (i: Intent) => void;
  disabled: boolean;
}) {
  const [qty, setQty] = useState(String(line.quantity));
  useEffect(() => setQty(String(line.quantity)), [line.quantity]);
  return (
    <div className="cart-line">
      <div className="cart-line-top">
        <ProductArt kind={p.icon} small />
        <div>
          <span className="sku">{p.sku}</span>
          <h4>{p.name}</h4>
          <small>{line.warehouse}</small>
        </div>
      </div>
      <div className="line-controls">
        <label className="sr-only" htmlFor={`qty-${keyOf(line)}`}>
          Количество {p.name}
        </label>
        <input
          id={`qty-${keyOf(line)}`}
          type="number"
          min={p.min}
          step={p.step}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <span>{p.unit}</span>
        <strong>{money(line.price * line.quantity)}</strong>
        <button
          className="icon-button"
          aria-label={`Удалить ${p.name}`}
          disabled={disabled}
          onClick={() => onPropose({ ...line, kind: "remove", quantity: 0 })}
        >
          <Trash2 size={16} />
        </button>
      </div>
      {Number(qty) !== line.quantity && (
        <button
          className="text-button"
          disabled={disabled}
          onClick={() =>
            onPropose({ ...line, kind: "set", quantity: Number(qty) })
          }
        >
          Подтвердить новое количество
        </button>
      )}
      <small>
        {money(line.price)} / {p.unit}
      </small>
    </div>
  );
}
