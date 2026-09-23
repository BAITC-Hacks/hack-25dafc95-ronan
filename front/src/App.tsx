import {
  ArrowRight,
  Check,
  Headphones,
  Menu,
  MessageCircle,
  Package,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Zap,
} from "lucide-react";
import { Assistant } from "./Assistant";
import "./assistant.css";
import { ProductArt } from "./components";
import { useAssistant } from "./useAssistant";
const money = (n: number) => new Intl.NumberFormat("ru-KZ").format(n) + " ₸";
export default function App() {
  const controller = useAssistant();
  const {
    source,
    products,
    cart,
    setCart,
    initError,
    open,
    setOpen,
    cartPage,
    setProposal,
    issue,
    setIssue,
    setMessages,
    sending,
    text,
    setText,
    setFile,
    setFileError,
    setUploadState,
    launchRef,
    demo,
    locked,
    send,
    switchMode,
    cartContent,
  } = controller;
  return (
    <div className="site">
      <div className="demo-ribbon">
        <span>
          <i />
          {demo ? "ДЕМОНСТРАЦИЯ" : "API-РЕЖИМ"}{" "}
          <b>
            {demo
              ? "Синтетические товары и цены. Заказы не отправляются."
              : "Подключение к сервисам команды"}
          </b>
        </span>
        <label>
          Источник данных{" "}
          <select
            aria-label="Источник данных"
            value={source.mode}
            disabled={locked || sending}
            onChange={(e) => switchMode(e.target.value)}
          >
            <option value="demo">Демо</option>
            <option value="api">API</option>
          </select>
        </label>
      </div>
      <header className="site-header">
        <a
          className="brand"
          href="#/"
          aria-label="ЭКТ — демонстрационная витрина"
        >
          <Zap fill="currentColor" size={32} />
          <span>
            экт<span className="brand-dot">.</span>
          </span>
          <small>
            ЭЛЕКТРОТЕХНИКА
            <br />
            ДЛЯ ВАШИХ ПРОЕКТОВ
          </small>
        </a>
        <form
          className="site-search"
          onSubmit={(e) => {
            e.preventDefault();
            setOpen(true);
            send(text);
          }}
        >
          <Search size={19} />
          <input
            aria-label="Найти в демокаталоге"
            placeholder="Что нужно для вашего проекта?"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <kbd>↵</kbd>
        </form>
        <button
          className="header-contact"
          onClick={() => {
            setOpen(true);
            send("Условия доставки");
          }}
        >
          <Headphones size={21} />
          <span>
            Поможем с выбором<small>Демонстрационный консультант</small>
          </span>
        </button>
        <a
          className="header-cart"
          href={source.cartUrl || "#/"}
          aria-label={`Корзина, ${cart.lines.length} позиций`}
        >
          <ShoppingBag size={23} />
          <span>{cart.lines.length}</span>
        </a>
      </header>
      <nav className="site-nav">
        <button
          onClick={() => {
            setOpen(true);
            send("Каталог");
          }}
        >
          <Menu size={18} /> Каталог товаров
        </button>
        <span>Кабель и провод</span>
        <span>Модульное оборудование</span>
        <span>Освещение</span>
        <button
          onClick={() => {
            setOpen(true);
            send("Условия доставки");
          }}
        >
          Оплата и доставка
        </button>
        <span className="nav-caption">Всё начинается с правильного выбора</span>
      </nav>
      <main>
        <div className="breadcrumbs">
          Главная <span>/</span>{" "}
          {cartPage ? "Демокорзина" : "Помощник по подбору"}
        </div>
        {cartPage ? (
          <section className="cart-page ekt-assistant">
            <a href="#/" className="back-link">
              ← Вернуться к помощнику
            </a>
            <h1>{demo ? "Ваша демокорзина" : "Ваша корзина"}</h1>
            <p className="muted">
              {demo
                ? "Сохраняется только в этом браузере. Это не заказ в магазине."
                : "Состояние корзины предоставляется сервисом команды."}
            </p>
            {initError && (
              <div role="alert" className="error-box">
                {initError}
              </div>
            )}
            {issue && (
              <div role="alert" className="notice">
                {issue}
              </div>
            )}
            <div className="page-cart-panel">{cartContent}</div>
            <p className="micro">
              Оформление заказа не подключено. Изменение и удаление позиции
              требуют подтверждения в помощнике.
            </p>
          </section>
        ) : (
          <>
            <section className="hero">
              <div className="hero-copy">
                <span className="eyebrow">
                  <span /> ВАШ ЭЛЕКТРОТЕХНИЧЕСКИЙ ПОМОЩНИК
                </span>
                <h1>
                  Нужный товар.
                  <br />
                  <span>Без лишних поисков.</span>
                </h1>
                <p>
                  Найдём характеристики, проверим наличие
                  <br className="desktop" /> и предложим альтернативу. Просто
                  спросите.
                </p>
                <div className="hero-tags">
                  <span>
                    <Check size={15} /> Подбор по параметрам
                  </span>
                  <span>
                    <Check size={15} /> Контроль корзины
                  </span>
                </div>
              </div>
              <div className="hero-graphic" aria-hidden="true">
                <div className="orbit one" />
                <div className="orbit two" />
                <div className="float-chip chip-a">
                  <ShieldCheck /> Характеристики
                </div>
                <div className="hero-spark">
                  <Zap size={58} fill="currentColor" />
                </div>
                <div className="float-chip chip-b">
                  <Package /> Наличие на складах
                </div>
                <span className="graphic-dot" />
              </div>
            </section>
            {open ? (
              <Assistant {...controller} />
            ) : (
              <div className="closed-assistant">
                <Sparkles />
                <h2>Помощник рядом</h2>
                <p>Откройте чат, чтобы подобрать товар.</p>
              </div>
            )}
            <section className="showcase">
              <div className="section-title">
                <div>
                  <span className="eyebrow">ЗНАКОМСТВО С КАТАЛОГОМ</span>
                  <h2>Для вашего следующего проекта</h2>
                </div>
                <button
                  onClick={() => {
                    setOpen(true);
                    send("Все товары");
                  }}
                >
                  Все демотовары <ArrowRight size={16} />
                </button>
              </div>
              <div className="showcase-grid">
                {products.slice(0, 3).map((p) => (
                  <button
                    className="showcase-card"
                    key={p.id}
                    onClick={() => {
                      setOpen(true);
                      send(p.sku);
                    }}
                  >
                    <ProductArt kind={p.icon} />
                    <div>
                      <span className="sku">{p.category}</span>
                      <h3>{p.name}</h3>
                      <strong>
                        {p.price === null ? "Цена неизвестна" : money(p.price)}{" "}
                        <small>/ {p.unit}</small>
                      </strong>
                    </div>
                    <ArrowRight size={18} />
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
      <footer>
        <span>
          экт. <small>Демонстрационный frontend · Hackathon Trade</small>
        </span>
        <div>
          {demo && (
            <button
              disabled={locked || sending}
              onClick={async () => {
                const c = await source.reset?.();
                if (c) setCart(c);
                setProposal(null);
                setMessages([]);
                setIssue("Демо сброшено.");
                setFile(undefined);
                setFileError("");
                setUploadState("");
              }}
            >
              Сбросить демо
            </button>
          )}
          <small>
            {demo
              ? "Данные корзины хранятся только в этом браузере."
              : "Данные предоставляет сервис команды."}
          </small>
        </div>
      </footer>
      <button
        ref={launchRef}
        className={`launcher ${open && !cartPage ? "launcher-hidden-mobile" : ""}`}
        onClick={() => {
          if (cartPage) location.hash = "/";
          setOpen((v) => (cartPage ? true : !v));
        }}
      >
        <MessageCircle size={21} />
        <span>
          {open && !cartPage ? "Помощник открыт" : "Спросить помощника"}
        </span>
        <span className="launcher-dot" />
      </button>
    </div>
  );
}
