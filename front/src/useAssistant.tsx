import { ArrowRight, ShieldCheck, ShoppingBag, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./assistant.css";
import { emptyCart, exactConsent, keyOf } from "./cartEngine";
import { CartLine } from "./components";
import { createApiSource, createDemoSource } from "./data";
import type {
  Cart,
  ChatResult,
  DataSource,
  Intent,
  Product,
  Proposal,
} from "./types";
const money = (n: number) => new Intl.NumberFormat("ru-KZ").format(n) + " ₸";
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Не удалось выполнить запрос.";
const maxMB =
  Number(import.meta.env.VITE_MAX_ATTACHMENT_MB) > 0
    ? Number(import.meta.env.VITE_MAX_ATTACHMENT_MB)
    : 10;
const allowed = /\.(xlsx?|docx?|pdf|jpe?g)$/i;
type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  result?: ChatResult;
  retry?: { text: string; file?: File };
  success?: boolean;
};
export function useAssistant(initialSource?: DataSource) {
  const initialMode = (() => {
    try {
      const selected = sessionStorage.getItem("ekt-data-mode");
      if (selected === "api" || selected === "demo") return selected;
    } catch { /* Browsers may disable storage. */ }
    return import.meta.env.VITE_DATA_MODE === "api" ? "api" : "demo";
  })();
  const [source, setSource] = useState<DataSource>(
    () =>
      initialSource ??
      (initialMode === "api" ? createApiSource() : createDemoSource()),
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Cart>(emptyCart);
  const [initError, setInitError] = useState("");
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(
    () => matchMedia("(max-width: 760px)").matches,
  );
  const [open, setOpen] = useState(true);
  const [cartPage, setCartPage] = useState(location.hash === "#/cart");
  const [mobileCart, setMobileCart] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [issue, setIssue] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState("");
  const [uploadState, setUploadState] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const assistantRef = useRef<HTMLElement>(null);
  const launchRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addMessage = (m: Omit<Message, "id">) =>
    setMessages((ms) => [...ms, { ...m, id: crypto.randomUUID() }]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setInitError("");
    setProducts([]);
    setCart(emptyCart());
    Promise.all([source.getCatalog(), source.getCart()])
      .then(([p, c]) => {
        if (alive) {
          setProducts(p);
          setCart(c);
        }
      })
      .catch((e) => alive && setInitError(errorText(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source]);
  useEffect(() => {
    const listener = () => {
      setCartPage(location.hash === "#/cart");
      setMobileCart(false);
    };
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    if (bottomRef.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending, proposal, issue]);
  useEffect(() => {
    if (!open) launchRef.current?.focus({ preventScroll: true });
    if (open && !cartPage) {
      if (mobileCart)
        assistantRef.current
          ?.querySelector<HTMLButtonElement>(".cart-title button")
          ?.focus();
      else inputRef.current?.focus({ preventScroll: true });
    }
  }, [open, cartPage, mobileCart]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      document.documentElement.style.setProperty(
        "--viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
    };
    update();
    viewport?.addEventListener("resize", update);
    return () => viewport?.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const update = () => setIsMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const modal = isMobile && open && !cartPage;
    const previous = document.body.style.overflow;
    if (modal) document.body.style.overflow = "hidden";
    const background = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".demo-ribbon,.site-header,.site-nav,.breadcrumbs,.hero,.showcase,.site>footer,.launcher",
      ),
    );
    background.forEach((el) => {
      el.inert = modal;
    });
    return () => {
      document.body.style.overflow = previous;
      background.forEach((el) => {
        el.inert = false;
      });
    };
  }, [isMobile, open, cartPage]);
  const total = cart.lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const demo = source.mode === "demo";
  const locked = busy || uncertain;
  async function propose(intent: Intent) {
    if (busyRef.current || uncertain) return;
    busyRef.current = true;
    setBusy(true);
    setProposal((previous) =>
      previous?.status === "active"
        ? { ...previous, status: "superseded" }
        : previous,
    );
    setIssue("");
    try {
      const next = await source.propose(intent);
      setProposal(next);
      setOpen(true);
      setMobileCart(false);
      if (cartPage) location.hash = "/";
      bottomRef.current = true;
    } catch (e) {
      setIssue(errorText(e));
      setOpen(true);
      setMobileCart(false);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function reconcile(id: string) {
    try {
      const result = await source.reconcile(id);
      setCart(result.cart);
      if (result.status === "unknown") {
        setUncertain(true);
        setIssue(
          "Статус операции пока неизвестен. Изменения заблокированы. Повторите сверку.",
        );
        return;
      }
      setUncertain(false);
      setProposal((p) =>
        p
          ? { ...p, status: result.status === "applied" ? "done" : "cancelled" }
          : p,
      );
      setIssue(
        result.status === "applied"
          ? "Сверка завершена: операция выполнена."
          : "Операция не выполнена. Создайте новое предложение и подтвердите его.",
      );
      if (result.status === "applied")
        addMessage({
          role: "assistant",
          text: "Корзина сверена с сервисом.",
          success: true,
        });
    } catch (e) {
      setUncertain(true);
      setIssue(
        `Не удалось сверить корзину: ${errorText(e)} Повторное изменение заблокировано.`,
      );
    }
  }
  async function confirm() {
    if (
      !proposal ||
      proposal.status !== "active" ||
      busyRef.current ||
      uncertain
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setIssue("");
    const current = proposal;
    setProposal({ ...current, status: "pending" });
    try {
      const result = await source.commit(current);
      setCart(result.cart);
      if (result.kind === "changed") {
        setProposal(result.proposal);
        setIssue(result.message);
      } else {
        setProposal({ ...current, status: "done" });
        addMessage({
          role: "assistant",
          text: `Готово. ${current.intent.kind === "remove" ? "Товар удалён из" : "Товар обновлён в"} ${demo ? "локальной демо" : "вашей"} корзине.`,
          success: true,
        });
      }
    } catch (e) {
      setIssue(errorText(e));
      await reconcile(current.id);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function cancel() {
    if (!proposal || proposal.status !== "active" || busyRef.current || uncertain) return;
    busyRef.current = true;
    setBusy(true);
    setIssue("");
    const current = proposal;
    try {
      if (!source.cancel) throw new Error("Отмена не подключена к сервису.");
      await source.cancel(current.id);
      setProposal({ ...current, status: "cancelled" });
      setIssue("Предложение отменено. Корзина не изменилась.");
    } catch (error) {
      setIssue(`Не удалось подтвердить отмену: ${errorText(error)}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function send(value = text, retryId?: string, retryFile?: File) {
    const attachment = retryId ? retryFile : file;
    const query = value.trim();
    if ((!query && !attachment) || sendingRef.current || locked) return;
    if (exactConsent(query) && !attachment && !retryId) {
      setText("");
      if (
        /добав/iu.test(query) &&
        proposal?.status === "active" &&
        proposal.intent.kind !== "add"
      ) {
        addMessage({
          role: "assistant",
          text: "Активное предложение изменяет или удаляет позицию. Фраза «добавь» его не подтверждает. Проверьте операцию и используйте её кнопку согласия.",
        });
        return;
      }
      if (proposal?.status === "active") {
        addMessage({ role: "user", text: query });
        await confirm();
      } else
        addMessage({
          role: "assistant",
          text: "Нет одного активного предложения. Выберите товар, склад и количество — затем подтвердите конкретное изменение.",
        });
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setIssue("");
    if (retryId) setMessages((ms) => ms.filter((m) => m.id !== retryId));
    else {
      addMessage({
        role: "user",
        text: [
          query,
          attachment
            ? `Вложение: ${attachment.name} (${(attachment.size / 1024).toFixed(1)} КБ)`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
      setText("");
      setFile(undefined);
    }
    try {
      if (attachment) {
        if (!source.upload) {
          setUploadState("Обработка документов не подключена");
          addMessage({
            role: "assistant",
            text: demo
              ? "Файл не загружен и не обработан. Frontend не читает документы. Подготовленный пример подбора по спецификации: кабель DEMO-1001. Содержимое вашего файла не использовалось."
              : "Загрузка файлов не подключена. Команда должна предоставить механизм загрузки.",
            result: demo
              ? { text: "", products: products.filter((p) => p.id === "c1") }
              : undefined,
          });
        } else {
          setUploadState("Отправка и обработка файла…");
          const result = await source.upload(attachment);
          addMessage({ role: "assistant", text: result.text });
          setUploadState("Обработка сервисом завершена");
        }
      }
      if (query) {
        const result = await source.chat(query);
        addMessage({ role: "assistant", text: result.text, result });
      }
    } catch (e) {
      addMessage({
        role: "assistant",
        text: errorText(e),
        retry: { text: query, file: attachment },
      });
      setUploadState("");
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }
  function selectFile(f?: File) {
    setFileError("");
    if (!f) return;
    if (!allowed.test(f.name)) {
      setFileError(
        "Допустимы Excel (.xls, .xlsx), Word (.doc, .docx), PDF и JPEG.",
      );
      return;
    }
    if (f.size > maxMB * 1024 * 1024 || f.size === 0) {
      setFileError(`Выберите непустой файл до ${maxMB} МБ.`);
      return;
    }
    setFile(f);
    setUploadState("");
  }
  function switchMode(mode: string) {
    if (locked || sending) return;
    try { sessionStorage.setItem("ekt-data-mode", mode === "api" ? "api" : "demo"); }
    catch { /* The current page can still switch mode. */ }
    setSource(mode === "api" ? createApiSource() : createDemoSource());
    setMessages([]);
    setProposal(null);
    setIssue("");
    setFile(undefined);
    setUploadState("");
  }
  function close() {
    setOpen(false);
    setMobileCart(false);
    launchRef.current?.focus();
  }
  function handleKeys(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (mobileCart) {
        setMobileCart(false);
      } else close();
    }
    if (e.key === "Tab" && matchMedia("(max-width: 760px)").matches) {
      const items = Array.from(
        assistantRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],input,select,textarea",
        ) ?? [],
      ).filter((el) => el.getClientRects().length);
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  }
  const cartContent = (
    <>
      <div className="cart-title">
        <div>
          <ShoppingBag size={19} />
          <h2>Ваша корзина</h2>
          <span className="count">{cart.lines.length}</span>
        </div>
        {mobileCart && (
          <button
            className="icon-button"
            aria-label="Вернуться в чат"
            onClick={() => setMobileCart(false)}
          >
            <X size={20} />
          </button>
        )}
      </div>
      <div className="cart-items">
        {cart.lines.length ? (
          cart.lines.map((l) => {
            const p = products.find((p) => p.id === l.productId);
            return p ? (
              <CartLine
                key={keyOf(l)}
                p={p}
                line={l}
                onPropose={propose}
                disabled={locked || loading || source.mode === "api"}
              />
            ) : (
              <p key={keyOf(l)}>Данные товара {l.productId} недоступны.</p>
            );
          })
        ) : (
          <div className="empty-cart">
            <div>
              <ShoppingBag size={30} />
            </div>
            <h3>Здесь будут ваши товары</h3>
            <p>
              Подберите нужное с помощником.
              <br />
              Добавление — только с вашего согласия.
            </p>
          </div>
        )}
      </div>
      <div className="cart-bottom">
        {source.mode === "api" && (
          <p className="micro">Изменение и удаление позиций через API пока не подключены.</p>
        )}
        <div className="cart-sum">
          <span>Итого</span>
          <strong>{money(total)}</strong>
        </div>
        <p className="micro">Без учёта доставки · {cart.lines.length} поз.</p>
        {source.cartUrl ? (
          <a className="primary cart-link" href={source.cartUrl}>
            Перейти в корзину <ArrowRight size={17} />
          </a>
        ) : (
          <p className="notice">Адрес реальной корзины не предоставлен.</p>
        )}
        <div className="safe-note">
          <ShieldCheck size={16} />
          <span>
            {demo
              ? "Локальная демокорзина. Не связана с ekt.kz."
              : "Корзина сервиса команды."}
          </span>
        </div>
      </div>
    </>
  );
  return {
    isMobile,
    source,
    setSource,
    products,
    cart,
    setCart,
    initError,
    loading,
    open,
    setOpen,
    cartPage,
    mobileCart,
    setMobileCart,
    proposal,
    setProposal,
    issue,
    setIssue,
    uncertain,
    busy,
    busyRef,
    setBusy,
    messages,
    setMessages,
    sending,
    text,
    setText,
    file,
    setFile,
    fileError,
    setFileError,
    uploadState,
    setUploadState,
    atBottom,
    setAtBottom,
    scrollRef,
    bottomRef,
    inputRef,
    assistantRef,
    launchRef,
    fileRef,
    addMessage,
    total,
    demo,
    locked,
    propose,
    reconcile,
    confirm,
    cancel,
    send,
    selectFile,
    switchMode,
    close,
    handleKeys,
    cartContent,
  };
}
export type AssistantController = ReturnType<typeof useAssistant>;
